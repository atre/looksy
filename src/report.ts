import type { Page } from 'playwright';

/**
 * Generate a text-only structured summary of the page (~100 tokens).
 * No screenshot needed — this is the cheapest verification mode.
 * Includes lightweight a11y and contrast checks automatically.
 */
export async function generateReport(page: Page, viewport: { width: number; height: number }, pageUrl?: string): Promise<string> {
  const data = await page.evaluate((vpHeight: number) => {
    const title = document.title;
    const pageHeight = document.documentElement.scrollHeight;

    // Heading counts
    const h1 = document.querySelectorAll('h1').length;
    const h2 = document.querySelectorAll('h2').length;
    const h3 = document.querySelectorAll('h3').length;

    // Sections
    const sections = document.querySelectorAll('section, main, header, footer, nav, article, aside').length;

    // Images
    const totalImages = document.querySelectorAll('img').length;
    // Broken = the load finished and produced no pixels. `!complete` is a lazy/off-screen
    // image that simply hasn't been requested yet — counting it produced "3 broken" on
    // pages where every <img> returned 200.
    let brokenImages = 0;
    let pendingImages = 0;
    for (const img of document.querySelectorAll('img')) {
      if (!img.complete) { pendingImages++; continue; }
      if (img.naturalWidth === 0 && (img.currentSrc || img.src)) brokenImages++;
    }

    // Links
    const totalLinks = document.querySelectorAll('a[href]').length;
    let externalLinks = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      if ((a as HTMLAnchorElement).hostname !== location.hostname) externalLinks++;
    }

    // Forms/inputs
    const forms = document.querySelectorAll('form').length;
    const inputs = document.querySelectorAll('input, textarea, select').length;
    const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]').length;

    // Colors: body bg + text
    const bodyCs = getComputedStyle(document.body);
    const bodyBg = bodyCs.backgroundColor;
    const bodyColor = bodyCs.color;

    // Fonts
    const fontSet = new Set<string>();
    for (const el of document.querySelectorAll('body, h1, h2, p, a, button')) {
      const ff = getComputedStyle(el).fontFamily;
      if (ff) fontSet.add(ff.split(',')[0].trim().replace(/['"]/g, ''));
    }

    // Above-fold element count
    let aboveFold = 0;
    let belowFold = 0;
    for (const el of document.querySelectorAll('h1, h2, h3, section, nav, header, footer, [class*="hero"], [class*="cta"], button')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      if (rect.top < vpHeight) aboveFold++;
      else belowFold++;
    }

    // --- Lightweight a11y checks ---
    const a11yIssues: string[] = [];
    const imgsNoAlt = document.querySelectorAll('img:not([alt])').length;
    if (imgsNoAlt > 0) a11yIssues.push(`${imgsNoAlt} img missing alt`);

    let emptyLinks = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      const t = (a.textContent || '').trim();
      if (!t && !a.getAttribute('aria-label') && !a.querySelector('img[alt]')) emptyLinks++;
    }
    if (emptyLinks > 0) a11yIssues.push(`${emptyLinks} empty link(s)`);

    let unlabeledInputs = 0;
    for (const input of document.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
      const id = input.getAttribute('id');
      if (!input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby') && !(id && document.querySelector(`label[for="${id}"]`))) unlabeledInputs++;
    }
    if (unlabeledInputs > 0) a11yIssues.push(`${unlabeledInputs} unlabeled input(s)`);

    if (!document.documentElement.getAttribute('lang')) a11yIssues.push('missing lang');

    // Heading order check — screen-reader-visible headings only: display:none / aria-hidden
    // subtrees (unmounted mobile sheets, closed dialogs) are skipped, sr-only headings kept.
    let prevLevel = 0;
    let headingSkips = 0;
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (el.getClientRects().length === 0 || el.closest('[aria-hidden="true"]')) continue;
      const level = parseInt(el.tagName[1]);
      if (level > prevLevel + 1 && prevLevel > 0) headingSkips++;
      prevLevel = level;
    }
    if (headingSkips > 0) a11yIssues.push(`${headingSkips} heading skip(s)`);

    // --- Lightweight contrast check ---
    // Object method pattern to avoid named functions inside evaluate
    // (esbuild keepNames wraps standalone named bindings with __name() which breaks in browser context)
    const $ = {
      srgbLin(c: number): number {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      },
      lum(r: number, g: number, b: number): number {
        return 0.2126 * $.srgbLin(r) + 0.7152 * $.srgbLin(g) + 0.0722 * $.srgbLin(b);
      },
      parseRgb(color: string): [number, number, number] | null {
        const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
      },
    };

    let contrastFailures = 0;
    let contrastChecked = 0;
    const seen = new Set<Element>();
    for (const el of document.querySelectorAll('h1,h2,h3,h4,p,a,button,span,li,label')) {
      if (seen.has(el) || contrastChecked >= 20) continue;
      const text = (el.textContent || '').trim();
      if (!text || text.length < 2) continue;
      seen.add(el);

      const style = getComputedStyle(el);
      const fg = $.parseRgb(style.color);
      if (!fg) continue;

      // Walk up for non-transparent bg
      let bg: [number, number, number] = [255, 255, 255];
      let cur: Element | null = el;
      while (cur) {
        const bgColor = getComputedStyle(cur).backgroundColor;
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
          const parsed = $.parseRgb(bgColor);
          if (parsed) { bg = parsed; break; }
        }
        cur = cur.parentElement;
      }

      const l1 = $.lum(...fg);
      const l2 = $.lum(...bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const fontSize = parseFloat(style.fontSize);
      const isBold = parseInt(style.fontWeight) >= 700;
      const isLarge = fontSize >= 18 || (fontSize >= 14 && isBold);
      const aaThreshold = isLarge ? 3 : 4.5;

      contrastChecked++;
      if (ratio < aaThreshold) contrastFailures++;
    }

    // --- JSON-LD schema types ---
    const schemaTypes: string[] = [];
    const seenLd = new Set<string>(); // dedupe re-injected (hydrated) duplicate blocks
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const json = JSON.parse(el.textContent || '');
        const key = JSON.stringify(json);
        if (seenLd.has(key)) continue;
        seenLd.add(key);
        const roots = Array.isArray(json) ? json : [json];
        for (const root of roots) {
          if (!root || typeof root !== 'object') continue;
          if (root['@type']) schemaTypes.push(String(root['@type']));
          if (Array.isArray(root['@graph'])) {
            for (const item of root['@graph']) {
              if (item && item['@type']) schemaTypes.push(String(item['@type']));
            }
          }
        }
      } catch { /* invalid JSON-LD */ }
    }

    return {
      title,
      pageHeight,
      h1, h2, h3,
      sections,
      totalImages, brokenImages, pendingImages,
      totalLinks, externalLinks,
      forms, inputs, buttons,
      bodyBg, bodyColor,
      fonts: Array.from(fontSet),
      aboveFold, belowFold,
      a11yIssues,
      contrastFailures,
      contrastChecked,
      schemaTypes,
    };
  }, viewport.height);

  const lines: string[] = [];
  lines.push(`# Report: ${data.title}`);
  if (pageUrl) lines.push(`URL: ${pageUrl}`);
  lines.push(`Viewport: ${viewport.width}x${viewport.height} | Page: ${data.pageHeight}px | ${data.sections} sections`);
  lines.push(`Headings: ${data.h1} H1, ${data.h2} H2, ${data.h3} H3`);
  lines.push(`Fold: ${data.aboveFold} elements above, ${data.belowFold} below`);
  const imgNotes = [
    data.brokenImages > 0 ? `${data.brokenImages} broken` : '',
    data.pendingImages > 0 ? `${data.pendingImages} lazy/not loaded` : '',
  ].filter(Boolean);
  lines.push(`Images: ${data.totalImages}${imgNotes.length ? ` (${imgNotes.join(', ')})` : ''} | Links: ${data.totalLinks} (${data.externalLinks} external)`);
  lines.push(`Interactive: ${data.buttons} buttons, ${data.inputs} inputs, ${data.forms} forms`);
  lines.push(`Colors: bg=${data.bodyBg} text=${data.bodyColor}`);
  lines.push(`Fonts: ${data.fonts.join(', ')}`);
  if (data.schemaTypes.length > 0) {
    lines.push(`Schema: ${data.schemaTypes.join(', ')}`);
  }

  // Flag issues
  const issues: string[] = [];
  if (data.h1 === 0) issues.push('no H1');
  if (data.h1 > 1) issues.push(`${data.h1} H1s`);
  if (data.brokenImages > 0) issues.push(`${data.brokenImages} broken images`);
  if (data.sections === 0) issues.push('no semantic sections');

  if (issues.length > 0) {
    lines.push(`Issues: ${issues.join(', ')}`);
  } else {
    lines.push('Issues: none');
  }

  // A11y summary
  if (data.a11yIssues.length > 0) {
    lines.push(`A11y: ${data.a11yIssues.join(', ')} (run --a11y for details)`);
  } else {
    lines.push('A11y: ok');
  }

  // Contrast summary
  if (data.contrastFailures > 0) {
    lines.push(`Contrast: ${data.contrastFailures}/${data.contrastChecked} elements fail AA (run --contrast for details)`);
  } else {
    lines.push(`Contrast: all ${data.contrastChecked} elements pass AA`);
  }

  lines.push('');

  return lines.join('\n');
}
