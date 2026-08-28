import type { Page } from 'playwright';

export interface A11yData {
  landmarks: Array<{ role: string; tag: string; label?: string; childCount: number }>;
  headings: Array<{ level: number; text: string }>;
  interactiveCount: { links: number; buttons: number; inputs: number; forms: number };
  issues: string[];
}

/** Extract raw accessibility data from the page. */
export async function extractA11yData(
  page: Page,
  opts: { fragment?: boolean } = {},
): Promise<A11yData> {
  const fragment = opts.fragment ?? false;
  return page.evaluate((fragment: boolean) => {
    // Landmark detection
    const landmarks: Array<{ role: string; tag: string; label?: string; childCount: number }> = [];
    const landmarkSelectors: Record<string, string> = {
      banner: 'header, [role="banner"]',
      navigation: 'nav, [role="navigation"]',
      main: 'main, [role="main"]',
      contentinfo: 'footer, [role="contentinfo"]',
      complementary: 'aside, [role="complementary"]',
      search: '[role="search"]',
      form: 'form[aria-label], form[aria-labelledby], [role="form"]',
      region: 'section[aria-label], section[aria-labelledby], [role="region"]',
    };

    for (const [role, sel] of Object.entries(landmarkSelectors)) {
      for (const el of document.querySelectorAll(sel)) {
        const label =
          el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || undefined;
        landmarks.push({
          role,
          tag: el.tagName.toLowerCase(),
          label,
          childCount: el.children.length,
        });
      }
    }

    // Heading structure
    // Screen-reader-visible headings only: skip display:none / aria-hidden subtrees (unmounted
    // mobile sheets, closed dialogs) — but keep sr-only ones, which assistive tech does read.
    const headings: Array<{ level: number; text: string }> = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (el.getClientRects().length === 0 || el.closest('[aria-hidden="true"]')) continue;
      headings.push({
        level: parseInt(el.tagName[1]),
        text: (el.textContent || '').trim().slice(0, 60),
      });
    }

    // Links and buttons
    const interactiveCount = {
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll('button, [role="button"], input[type="submit"]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      forms: document.querySelectorAll('form').length,
    };

    // Issues
    const issues: string[] = [];
    const imgsNoAlt = document.querySelectorAll('img:not([alt])');
    if (imgsNoAlt.length > 0) {
      const names = Array.from(imgsNoAlt)
        .slice(0, 3)
        .map(
          (i) =>
            ((i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src || '')
              .split('/')
              .pop()
              ?.split('?')[0]
              ?.slice(0, 40) || '?',
        );
      issues.push(
        `${imgsNoAlt.length} image(s) missing alt text: ${names.join(', ')}${imgsNoAlt.length > 3 ? ', …' : ''}`,
      );
    }

    let emptyLinks = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      const text = (a.textContent || '').trim();
      const ariaLabel = a.getAttribute('aria-label');
      const img = a.querySelector('img[alt]');
      if (!text && !ariaLabel && !img) emptyLinks++;
    }
    if (emptyLinks > 0) issues.push(`${emptyLinks} link(s) with no accessible text`);

    let emptyButtons = 0;
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      const text = (btn.textContent || '').trim();
      const ariaLabel = btn.getAttribute('aria-label');
      if (!text && !ariaLabel) emptyButtons++;
    }
    if (emptyButtons > 0) issues.push(`${emptyButtons} button(s) with no accessible text`);

    let unlabeledInputs = 0;
    for (const input of document.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
      const id = input.getAttribute('id');
      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledBy = input.getAttribute('aria-labelledby');
      const hasLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
      if (!ariaLabel && !ariaLabelledBy && !hasLabel) unlabeledInputs++;
    }
    if (unlabeledInputs > 0) issues.push(`${unlabeledInputs} input(s) without associated label`);

    // Broad skip-nav detection: exact matches + href containing "main" or "content"
    let skipLink = document.querySelector('a[href="#main"], a[href="#content"], [class*="skip"]');
    if (!skipLink) {
      // Check for href values containing "main" or "content" as substrings
      skipLink = document.querySelector('a[href*="main"], a[href*="content"]');
    }
    if (!skipLink) issues.push('No skip navigation link found');

    // --fragment: a piped component preview has no <html lang> by design — not a real issue.
    const lang = document.documentElement.getAttribute('lang');
    if (!lang && !fragment) issues.push('Missing lang attribute on <html>');

    let prevLevel = 0;
    let prevText = '';
    for (const h of headings) {
      if (h.level > prevLevel + 1 && prevLevel > 0) {
        // Name both headings so the finding is self-locating (e.g. an accordion h3 after the h1).
        issues.push(
          `Heading level skipped: h${prevLevel} "${prevText.slice(0, 30)}" → h${h.level} "${h.text.slice(0, 30)}"`,
        );
      }
      prevLevel = h.level;
      prevText = h.text;
    }

    const h1Count = headings.filter((h) => h.level === 1).length;
    if (h1Count > 1) issues.push(`${h1Count} H1 elements found (should be 1)`);
    if (h1Count === 0) issues.push('No H1 element found');

    return { landmarks, headings, interactiveCount, issues };
  }, fragment);
}

/** Format a11y data as markdown. */
export function formatA11y(data: A11yData, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? false;

  if (compact && data.issues.length === 0) {
    return '## A11y: No issues\n';
  }

  if (compact) {
    const lines: string[] = [];
    lines.push(`## A11y: ${data.issues.length} issue(s)`);
    for (const issue of data.issues) lines.push(`- ${issue}`);
    lines.push(`Landmarks: ${data.landmarks.map((lm) => lm.role).join(', ') || 'none'}`);
    lines.push(
      `Interactive: ${data.interactiveCount.links} links, ${data.interactiveCount.buttons} buttons, ${data.interactiveCount.inputs} inputs`,
    );
    lines.push('');
    return lines.join('\n');
  }

  const lines: string[] = ['## Accessibility Audit\n'];

  lines.push('### Landmarks\n');
  if (data.landmarks.length === 0) {
    lines.push('**No ARIA landmarks found** — page lacks semantic structure.\n');
  } else {
    for (const lm of data.landmarks) {
      const label = lm.label ? ` "${lm.label}"` : '';
      lines.push(`- **${lm.role}** (\`${lm.tag}\`${label})`);
    }
    lines.push('');
  }

  lines.push('### Heading Order\n');
  for (const h of data.headings) {
    const indent = '  '.repeat(h.level - 1);
    lines.push(`${indent}- H${h.level}: ${h.text}`);
  }
  lines.push('');

  lines.push('### Interactive Elements\n');
  lines.push(`- Links: ${data.interactiveCount.links}`);
  lines.push(`- Buttons: ${data.interactiveCount.buttons}`);
  lines.push(`- Form inputs: ${data.interactiveCount.inputs}`);
  lines.push(`- Forms: ${data.interactiveCount.forms}`);
  lines.push('');

  if (data.issues.length > 0) {
    lines.push(`### Issues (${data.issues.length})\n`);
    for (const issue of data.issues) lines.push(`- ${issue}`);
    lines.push('');
  } else {
    lines.push('### No accessibility issues detected.\n');
  }

  return lines.join('\n');
}
