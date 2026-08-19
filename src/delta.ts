import type { Page } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { LOOKSY_DIR } from './utils.js';

const SNAPSHOT_PATH = `${LOOKSY_DIR}/.last-snapshot.json`;

export interface DeltaSnapshot {
  url: string;
  capturedAt: string;
  title: string;
  pageHeight: number;
  elementCount: number;
  fonts: string[];
  cssVarCount: number;
  colorPalette: string[];  // body bg + fg colors
  headingStructure: string; // "H1,H2,H2,H3" pattern
  contrastFailures: number;
  a11yIssueCount: number;
}

/**
 * Capture a lightweight delta snapshot from the page via page.evaluate().
 */
export async function captureDeltaSnapshot(page: Page, url: string): Promise<DeltaSnapshot> {
  const data = await page.evaluate(() => {
    const title = document.title;
    const pageHeight = document.documentElement.scrollHeight;
    const elementCount = document.querySelectorAll('*').length;

    // Font families from key elements
    const fontSet = new Set<string>();
    for (const el of document.querySelectorAll('body, h1, h2, p, a, button')) {
      const ff = getComputedStyle(el).fontFamily;
      if (ff) fontSet.add(ff.split(',')[0].trim().replace(/['"]/g, ''));
    }

    // CSS var count from :root / html
    let cssVarCount = 0;
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === 'html')) {
              for (const prop of rule.style) {
                if (prop.startsWith('--')) cssVarCount++;
              }
            }
          }
        } catch { /* cross-origin sheet */ }
      }
    } catch { /* styleSheets access error */ }

    // Body bg + fg color palette
    const bodyCs = getComputedStyle(document.body);
    const colorPalette: string[] = [bodyCs.backgroundColor, bodyCs.color].filter(Boolean);

    // Heading sequence pattern e.g. "H1,H2,H2,H3"
    const headings: string[] = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      headings.push(el.tagName); // H1, H2, etc.
    }
    const headingStructure = headings.join(',');

    // --- Lightweight a11y issues ---
    let a11yIssueCount = 0;

    const imgsNoAlt = document.querySelectorAll('img:not([alt])').length;
    if (imgsNoAlt > 0) a11yIssueCount++;

    for (const a of document.querySelectorAll('a[href]')) {
      const t = (a.textContent || '').trim();
      if (!t && !a.getAttribute('aria-label') && !a.querySelector('img[alt]')) {
        a11yIssueCount++;
        break; // count categories not individual elements
      }
    }

    for (const input of document.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
      const id = input.getAttribute('id');
      if (!input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby') && !(id && document.querySelector(`label[for="${id}"]`))) {
        a11yIssueCount++;
        break;
      }
    }

    if (!document.documentElement.getAttribute('lang')) a11yIssueCount++;

    let prevLevel = 0;
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const level = parseInt(el.tagName[1]);
      if (level > prevLevel + 1 && prevLevel > 0) { a11yIssueCount++; break; }
      prevLevel = level;
    }

    // --- Lightweight contrast check (up to 20 elements, WCAG AA) ---
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
      if (seen.has(el) || contrastChecked >= 20) break;
      const text = (el.textContent || '').trim();
      if (!text || text.length < 2) continue;
      seen.add(el);

      const style = getComputedStyle(el);
      const fg = $.parseRgb(style.color);
      if (!fg) continue;

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

    return {
      title,
      pageHeight,
      elementCount,
      fonts: Array.from(fontSet),
      cssVarCount,
      colorPalette,
      headingStructure,
      contrastFailures,
      a11yIssueCount,
    };
  });

  return {
    url,
    capturedAt: new Date().toISOString(),
    ...data,
  };
}

/**
 * Load the last snapshot for a given URL from the JSON map.
 * Returns null if not found or if the file does not exist.
 */
export function loadLastSnapshot(url: string): DeltaSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try {
    const map: Record<string, DeltaSnapshot> = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
    return map[url] ?? null;
  } catch {
    return null;
  }
}

/**
 * Save a snapshot into the JSON map keyed by URL.
 */
export function saveLastSnapshot(snapshot: DeltaSnapshot): void {
  if (!existsSync(LOOKSY_DIR)) mkdirSync(LOOKSY_DIR, { recursive: true, mode: 0o700 });

  let map: Record<string, DeltaSnapshot> = {};
  if (existsSync(SNAPSHOT_PATH)) {
    try {
      map = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
    } catch {
      map = {};
    }
  }

  map[snapshot.url] = snapshot;
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(map, null, 2));
}

/**
 * Compare two delta snapshots and produce a concise diff string (~80 tokens).
 * Only sections that actually changed are included.
 * Ends with a summary of unchanged dimensions.
 */
export function compareDeltaSnapshots(before: DeltaSnapshot, after: DeltaSnapshot): string {
  const changes: string[] = [];
  const unchanged: string[] = [];

  // title
  if (before.title !== after.title) {
    changes.push(`- title: "${before.title}" → "${after.title}"`);
  } else {
    unchanged.push('title');
  }

  // pageHeight
  if (before.pageHeight !== after.pageHeight) {
    const delta = after.pageHeight - before.pageHeight;
    const pct = before.pageHeight > 0 ? ((delta / before.pageHeight) * 100).toFixed(1) : '0';
    changes.push(`- pageHeight: ${before.pageHeight}px → ${after.pageHeight}px (${delta > 0 ? '+' : ''}${pct}%)`);
  } else {
    unchanged.push('pageHeight');
  }

  // elementCount
  if (before.elementCount !== after.elementCount) {
    const delta = after.elementCount - before.elementCount;
    changes.push(`- elementCount: ${before.elementCount} → ${after.elementCount} (${delta > 0 ? '+' : ''}${delta})`);
  } else {
    unchanged.push('elementCount');
  }

  // fonts
  const fontsBefore = new Set(before.fonts);
  const fontsAfter = new Set(after.fonts);
  const addedFonts = [...fontsAfter].filter(f => !fontsBefore.has(f));
  const removedFonts = [...fontsBefore].filter(f => !fontsAfter.has(f));
  if (addedFonts.length > 0 || removedFonts.length > 0) {
    const parts: string[] = [];
    if (removedFonts.length > 0) parts.push(`-${removedFonts.join(', ')}`);
    if (addedFonts.length > 0) parts.push(`+${addedFonts.join(', ')}`);
    changes.push(`- fonts: ${parts.join('; ')}`);
  } else {
    unchanged.push(`fonts (${after.fonts.length})`);
  }

  // cssVarCount
  if (before.cssVarCount !== after.cssVarCount) {
    const delta = after.cssVarCount - before.cssVarCount;
    changes.push(`- cssVarCount: ${before.cssVarCount} → ${after.cssVarCount} (${delta > 0 ? '+' : ''}${delta})`);
  } else {
    unchanged.push('cssVars');
  }

  // colorPalette
  const paletteBefore = before.colorPalette.join('|');
  const paletteAfter = after.colorPalette.join('|');
  if (paletteBefore !== paletteAfter) {
    changes.push(`- colorPalette: [${before.colorPalette.join(', ')}] → [${after.colorPalette.join(', ')}]`);
  } else {
    unchanged.push('colors');
  }

  // headingStructure
  if (before.headingStructure !== after.headingStructure) {
    const bStr = before.headingStructure || '(none)';
    const aStr = after.headingStructure || '(none)';
    changes.push(`- headings: ${bStr} → ${aStr}`);
  } else {
    unchanged.push('headings');
  }

  // contrastFailures
  if (before.contrastFailures !== after.contrastFailures) {
    const delta = after.contrastFailures - before.contrastFailures;
    changes.push(`- contrastFailures: ${before.contrastFailures} → ${after.contrastFailures} (${delta > 0 ? '+' : ''}${delta})`);
  } else {
    unchanged.push('contrast');
  }

  // a11yIssueCount
  if (before.a11yIssueCount !== after.a11yIssueCount) {
    const delta = after.a11yIssueCount - before.a11yIssueCount;
    changes.push(`- a11y: ${before.a11yIssueCount} issue(s) → ${after.a11yIssueCount} issue(s) (${delta > 0 ? '+' : ''}${delta})`);
  } else {
    unchanged.push('a11y');
  }

  if (changes.length === 0) {
    return '## Delta: No changes detected\n';
  }

  const lines: string[] = [];
  lines.push('## Delta (vs previous)');
  lines.push('');
  lines.push(...changes);
  if (unchanged.length > 0) {
    lines.push('');
    lines.push(`Unchanged: ${unchanged.join(', ')}`);
  }
  lines.push('');

  return lines.join('\n');
}
