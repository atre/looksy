import type { Page } from 'playwright';
import { extractFontSources } from './font-sources.js';

export interface CheckResult {
  assertion: string;
  pass: boolean;
  detail: string;
  /** True when the assertion name is not in the documented vocabulary (reported as FAIL). */
  unknown?: boolean;
}

export interface CheckRunResult {
  results: CheckResult[];
  allPass: boolean;
  /** Markdown block ("## Check Results …") — what --check prints and writes to the sidecar. */
  text: string;
}

/** Render CheckResult[] as the markdown block used on stdout and in the sidecar. */
export function formatCheckResults(results: CheckResult[]): string {
  const lines: string[] = ['## Check Results\n'];
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) allPass = false;
    lines.push(`- [${icon}] ${r.assertion} — ${r.detail}`);
  }
  lines.push('');
  lines.push(allPass ? 'All checks passed.' : 'Some checks failed.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Documented `--check` assertion vocabulary. Order matters: it is what `--help` prints and
 * what the "unknown assertion" error suggests. Keep in sync with cli-help.ts.
 */
export const CHECK_ASSERTIONS: Array<{ syntax: string; description: string }> = [
  { syntax: 'sticky header', description: '<header> is position: sticky/fixed' },
  { syntax: 'dark bg[:sel]', description: 'body (or element) background luminance < 0.5' },
  { syntax: 'light bg[:sel]', description: 'body (or element) background luminance >= 0.5' },
  { syntax: 'text:<phrase>', description: 'case-insensitive page text contains phrase' },
  { syntax: 'class:<name>', description: 'some element has a class containing <name>' },
  { syntax: 'selector:<css>', description: 'CSS selector matches at least one element' },
  { syntax: 'count:N <css>', description: 'exactly N elements match selector' },
  { syntax: 'has <css>', description: 'selector matches at least one element' },
  { syntax: 'no <pattern>', description: 'no element has <pattern> in class or inline style' },
  { syntax: 'visible <css>', description: 'element exists and is rendered' },
  { syntax: 'hidden <css>', description: 'element is hidden or absent' },
  { syntax: 'font:<css>=<family>', description: 'computed font-family matches' },
  { syntax: 'bg:<css>=<hex>', description: 'computed background-color matches (±5)' },
  { syntax: 'color:<css>=<hex>', description: 'computed text color matches (±5)' },
  { syntax: 'contrast:aa | contrast:aaa', description: 'WCAG contrast pass for sampled text' },
  { syntax: 'no-hscroll', description: 'page is not wider than the viewport (no horizontal scroll)' },
  { syntax: 'touch-targets[:N]', description: 'no control smaller than N px (default 44; inline text links exempt)' },
  { syntax: 'h1-count[:N]', description: 'exactly N <h1> (default 1)' },
  { syntax: 'heading-outline', description: 'no skipped heading levels (hidden headings ignored)' },
  { syntax: 'no-broken-images', description: 'no <img> failed to load (lazy not-yet-loaded is not broken)' },
  { syntax: 'alt-text', description: 'every <img> has an alt attribute' },
  { syntax: 'lang', description: '<html lang> is set' },
  { syntax: 'canonical', description: '<link rel="canonical"> present' },
  { syntax: 'meta-description', description: '<meta name="description"> present' },
  { syntax: 'og-image | og-title | og-tags', description: 'Open Graph image / title / title+description+image present' },
  { syntax: 'twitter-card', description: '<meta name="twitter:card"> present' },
  { syntax: 'no generator', description: 'no <meta name="generator"> (fingerprint)' },
  { syntax: 'translated', description: 'no common English UI phrases on a non-English page' },
  { syntax: 'self-hosted-fonts', description: 'no external font domains' },
  { syntax: 'no-google-fonts', description: 'no fonts.googleapis.com / fonts.gstatic.com' },
  { syntax: 'unique-footer | unique-nav', description: '<footer> / <nav> present (cross-page compare needs --pages)' },
];

/** Names accepted verbatim (case-insensitive) — everything else must match a prefixed form. */
const BARE_ASSERTIONS = new Set([
  'no-hscroll', 'touch-targets', 'h1-count', 'heading-outline', 'no-broken-images', 'alt-text',
  'lang', 'canonical', 'meta-description', 'og-image', 'og-title', 'og-tags', 'twitter-card',
  'no generator', 'translated', 'self-hosted-fonts', 'no-google-fonts', 'unique-footer', 'unique-nav',
  'contrast:aa', 'contrast:aaa',
]);

/**
 * True when the assertion matches a documented form. Unknown names used to fall through to a
 * page-text search and "fail" silently (`--check touch-targets` → "[FAIL] not found"), which
 * reads like a real finding; now they are reported as unknown with the vocabulary listed.
 */
export function isKnownAssertion(assertion: string): boolean {
  const lower = assertion.toLowerCase().trim();
  if (BARE_ASSERTIONS.has(lower)) return true;
  if (/^(touch-targets|h1-count):\d+$/.test(lower)) return true;
  if (lower.includes('sticky') && lower.includes('header')) return true;
  if (/^(dark|light)\s*(bg|background)(:.+)?$/.test(lower)) return true;
  if (/^(text|class|selector|count|font|bg|color):/.test(lower)) return true;
  if (/^(no|has|visible|hidden)\s+\S/.test(lower)) return true;
  return false;
}

/** Short vocabulary hint appended to unknown-assertion failures. */
export function knownAssertionHint(): string {
  return CHECK_ASSERTIONS.map((a) => a.syntax).join(', ');
}

/**
 * Run AI-defined assertions against the page DOM.
 * Returns pass/fail per assertion in ~50 tokens. See CHECK_ASSERTIONS for the grammar.
 */
export async function runChecks(page: Page, assertions: string, opts: { contrastLimit?: number } = {}): Promise<string> {
  return (await runChecksStructured(page, assertions, opts)).text;
}

/** Same as runChecks, but returns the per-assertion results too (MCP verdicts, JSON sidecar). */
export async function runChecksStructured(page: Page, assertions: string, opts: { contrastLimit?: number } = {}): Promise<CheckRunResult> {
  const items = assertions.split(',').map((s) => s.trim()).filter(Boolean);
  const contrastLimit = opts.contrastLimit ?? 150;

  // Async Node.js-side checks (require Playwright APIs, not just page.evaluate)
  const FONT_CHECK_ASSERTIONS = new Set(['self-hosted-fonts', 'no-google-fonts']);
  const STRUCTURAL_CHECK_ASSERTIONS = new Set(['unique-footer', 'unique-nav']);

  const asyncResults: CheckResult[] = [];

  // Font source checks — uses extractFontSources which queries CSS rules + network entries
  const fontCheckItems = items.filter((item) => FONT_CHECK_ASSERTIONS.has(item.toLowerCase().trim()));
  if (fontCheckItems.length > 0) {
    let fontData: Awaited<ReturnType<typeof extractFontSources>> | undefined;
    try {
      fontData = await extractFontSources(page);
    } catch { /* best-effort */ }

    for (const assertion of fontCheckItems) {
      const lower = assertion.toLowerCase().trim();
      if (!fontData) {
        asyncResults.push({ assertion, pass: false, detail: 'could not extract font sources' });
        continue;
      }
      if (lower === 'self-hosted-fonts') {
        if (fontData.externalDomains.length === 0) {
          asyncResults.push({ assertion, pass: true, detail: `all ${fontData.sources.length} font(s) self-hosted` });
        } else {
          asyncResults.push({ assertion, pass: false, detail: `external font domain(s) found: ${fontData.externalDomains.join(', ')}` });
        }
      } else if (lower === 'no-google-fonts') {
        const googleDomains = fontData.externalDomains.filter((d) =>
          d === 'fonts.googleapis.com' || d === 'fonts.gstatic.com',
        );
        const googleSources = fontData.sources.filter((s) =>
          s.url.includes('fonts.googleapis.com') || s.url.includes('fonts.gstatic.com'),
        );
        if (googleDomains.length === 0 && googleSources.length === 0) {
          asyncResults.push({ assertion, pass: true, detail: 'no Google Fonts URLs detected' });
        } else {
          const domains = [...new Set([...googleDomains, ...googleSources.map((s) => { try { return new URL(s.url).hostname; } catch { return s.url; } })])];
          asyncResults.push({ assertion, pass: false, detail: `Google Fonts detected: ${domains.join(', ')}` });
        }
      }
    }
  }

  // Structural checks — extract footer/nav HTML from the page
  const structuralCheckItems = items.filter((item) => STRUCTURAL_CHECK_ASSERTIONS.has(item.toLowerCase().trim()));
  if (structuralCheckItems.length > 0) {
    const structuralData = await page.evaluate(() => {
      const footer = document.querySelector('footer');
      const nav = document.querySelector('nav');
      return {
        footerHtml: footer ? footer.innerHTML.trim() : null,
        navHtml: nav ? nav.innerHTML.trim() : null,
        footerByteLength: footer ? footer.innerHTML.trim().length : 0,
        navByteLength: nav ? nav.innerHTML.trim().length : 0,
      };
    });

    for (const assertion of structuralCheckItems) {
      const lower = assertion.toLowerCase().trim();
      if (lower === 'unique-footer') {
        if (structuralData.footerHtml === null) {
          asyncResults.push({ assertion, pass: false, detail: 'no <footer> element found' });
        } else {
          asyncResults.push({ assertion, pass: true, detail: `<footer> present (${structuralData.footerByteLength} bytes) — use with --pages for cross-page comparison` });
        }
      } else if (lower === 'unique-nav') {
        if (structuralData.navHtml === null) {
          asyncResults.push({ assertion, pass: false, detail: 'no <nav> element found' });
        } else {
          asyncResults.push({ assertion, pass: true, detail: `<nav> present (${structuralData.navByteLength} bytes) — use with --pages for cross-page comparison` });
        }
      }
    }
  }

  // DOM-evaluated checks — filter out async-handled assertions
  const ASYNC_ASSERTIONS = new Set([...FONT_CHECK_ASSERTIONS, ...STRUCTURAL_CHECK_ASSERTIONS]);
  const domItems = items.filter((item) => !ASYNC_ASSERTIONS.has(item.toLowerCase().trim()));

  const domResults: CheckResult[] = domItems.length > 0 ? await page.evaluate((evalArgs: { checks: string[]; contrastLimit: number }) => {
    const { checks, contrastLimit } = evalArgs;
    // Object method pattern to avoid named functions inside evaluate
    // (esbuild keepNames wraps standalone named bindings with __name() which breaks in browser context)
    const $ = {
      getLuminance(color: string): number {
        const match = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return 1;
        const [r, g, b] = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        const toLinear = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
        return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
      },
      resolveBg(el: Element): string {
        let current: Element | null = el;
        while (current) {
          const bg = getComputedStyle(current).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
          current = current.parentElement;
        }
        return 'rgb(255, 255, 255)';
      },
      hexToRgb(hex: string): [number, number, number] | null {
        const h = hex.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(h)) return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        if (/^#[0-9a-fA-F]{3}$/.test(h)) return [parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), parseInt(h[3] + h[3], 16)];
        return null;
      },
      rgbToHex(r: number, g: number, b: number): string {
        return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
      },
      matchColor(computed: string, expected: string, tolerance = 5): { match: boolean; actual: string } {
        const m = computed.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return { match: false, actual: computed };
        const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
        const hex = $.rgbToHex(r, g, b);
        const exp = $.hexToRgb(expected);
        if (!exp) return { match: false, actual: hex };
        const pass = Math.abs(r - exp[0]) <= tolerance && Math.abs(g - exp[1]) <= tolerance && Math.abs(b - exp[2]) <= tolerance;
        return { match: pass, actual: hex };
      },
    };

    return checks.map((assertion): { assertion: string; pass: boolean; detail: string } => {
      const lower = assertion.toLowerCase().trim();

      // "sticky header" or "fixed header"
      if (lower.includes('sticky') && lower.includes('header')) {
        const header = document.querySelector('header');
        if (!header) return { assertion, pass: false, detail: 'no <header> found' };
        const pos = getComputedStyle(header).position;
        return { assertion, pass: pos === 'sticky' || pos === 'fixed', detail: `header position: ${pos}` };
      }

      // "dark bg[:.sel]" / "light bg[:.sel]" — scoped or body luminance check
      const bgMatch = lower.match(/^(dark|light)\s*(?:bg|background)(?::(.+))?$/);
      if (bgMatch) {
        const darkWanted = bgMatch[1] === 'dark';
        const sel = bgMatch[2] ? assertion.slice(assertion.indexOf(':') + 1).trim() : null;
        try {
          const el = sel ? document.querySelector(sel) : document.body;
          if (!el) return { assertion, pass: false, detail: `"${sel}" not found` };
          const bg = $.resolveBg(el);
          const lum = $.getLuminance(bg);
          const pass = darkWanted ? lum < 0.5 : lum >= 0.5;
          return { assertion, pass, detail: `bg=${bg} luminance=${lum.toFixed(2)}` };
        } catch { return { assertion, pass: false, detail: 'invalid selector' }; }
      }

      // "no generator" — check for meta[name="generator"] tag
      if (lower === 'no generator') {
        const gen = document.querySelector('meta[name="generator"]');
        if (!gen) return { assertion, pass: true, detail: 'no <meta name="generator"> found' };
        return { assertion, pass: false, detail: `generator: "${gen.getAttribute('content')}"` };
      }

      // "no .class" or "no pattern" — absence check
      if (lower.startsWith('no ')) {
        const pattern = assertion.slice(3).trim();
        const escaped = pattern.replace(/[\\"'\]]/g, (ch) => `\\${ch}`);
        // Try as selector first
        try {
          const found = document.querySelectorAll(`[class*="${escaped}"]`).length;
          if (found === 0) {
            // Also check inline styles
            const styleMatch = document.querySelectorAll(`[style*="${escaped}"]`).length;
            return { assertion, pass: styleMatch === 0, detail: `${styleMatch} element(s) with "${pattern}" in style` };
          }
          return { assertion, pass: false, detail: `${found} element(s) with "${pattern}" in class` };
        } catch {
          return { assertion, pass: true, detail: 'pattern not found' };
        }
      }

      // "has .selector" — presence check
      if (lower.startsWith('has ')) {
        const selector = assertion.slice(4).trim();
        try {
          const found = document.querySelectorAll(selector).length;
          return { assertion, pass: found > 0, detail: `${found} match(es)` };
        } catch {
          // Fall back to class search
          const escapedSel = selector.replace('.', '').replace(/[\\"'\]]/g, (ch) => `\\${ch}`);
          const found = document.querySelectorAll(`[class*="${escapedSel}"]`).length;
          return { assertion, pass: found > 0, detail: `${found} match(es)` };
        }
      }

      // "visible .selector"
      if (lower.startsWith('visible ')) {
        const selector = assertion.slice(8).trim();
        try {
          const el = document.querySelector(selector);
          if (!el) return { assertion, pass: false, detail: 'not found' };
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const isVisible = rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
          return { assertion, pass: isVisible, detail: isVisible ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : `display=${cs.display} visibility=${cs.visibility}` };
        } catch {
          return { assertion, pass: false, detail: 'invalid selector' };
        }
      }

      // "hidden .selector"
      if (lower.startsWith('hidden ')) {
        const selector = assertion.slice(7).trim();
        try {
          const el = document.querySelector(selector);
          if (!el) return { assertion, pass: true, detail: 'not found (hidden)' };
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const isHidden = rect.width === 0 || rect.height === 0 || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
          return { assertion, pass: isHidden, detail: isHidden ? 'hidden' : `visible ${Math.round(rect.width)}x${Math.round(rect.height)}` };
        } catch {
          return { assertion, pass: false, detail: 'invalid selector' };
        }
      }

      // "text:phrase" — case-insensitive page text search
      if (lower.startsWith('text:')) {
        const phrase = assertion.slice(5).trim();
        const found = document.body.textContent?.toLowerCase().includes(phrase.toLowerCase());
        return { assertion, pass: !!found, detail: found ? 'found in page text' : 'not found in page text' };
      }

      // "font:<selector>=<expected>" — computed font family check
      if (lower.startsWith('font:') && assertion.includes('=')) {
        const eqIdx = assertion.indexOf('=');
        const sel = assertion.slice(5, eqIdx).trim();
        const expected = assertion.slice(eqIdx + 1).trim();
        try {
          const el = document.querySelector(sel);
          if (!el) return { assertion, pass: false, detail: `"${sel}" not found` };
          const actual = getComputedStyle(el).fontFamily;
          const primary = actual.split(',')[0].trim().replace(/['"]/g, '');
          const pass = primary.toLowerCase() === expected.toLowerCase() ||
                       actual.toLowerCase().includes(expected.toLowerCase());
          return { assertion, pass, detail: `font-family: ${primary}` };
        } catch { return { assertion, pass: false, detail: 'invalid selector' }; }
      }

      // "bg:<selector>=<hex>" — computed background color check
      if (lower.startsWith('bg:') && assertion.includes('=')) {
        const eqIdx = assertion.indexOf('=');
        const sel = assertion.slice(3, eqIdx).trim();
        const expected = assertion.slice(eqIdx + 1).trim();
        try {
          const el = document.querySelector(sel);
          if (!el) return { assertion, pass: false, detail: `"${sel}" not found` };
          const bg = $.resolveBg(el);
          const result = $.matchColor(bg, expected);
          return { assertion, pass: result.match, detail: `bg: ${result.actual} (expected ${expected})` };
        } catch { return { assertion, pass: false, detail: 'invalid selector' }; }
      }

      // "color:<selector>=<hex>" — computed text color check
      if (lower.startsWith('color:') && assertion.includes('=') && !lower.startsWith('contrast:')) {
        const eqIdx = assertion.indexOf('=');
        const sel = assertion.slice(6, eqIdx).trim();
        const expected = assertion.slice(eqIdx + 1).trim();
        try {
          const el = document.querySelector(sel);
          if (!el) return { assertion, pass: false, detail: `"${sel}" not found` };
          const color = getComputedStyle(el).color;
          const result = $.matchColor(color, expected);
          return { assertion, pass: result.match, detail: `color: ${result.actual} (expected ${expected})` };
        } catch { return { assertion, pass: false, detail: 'invalid selector' }; }
      }

      // "selector:.css" — CSS selector presence check
      if (lower.startsWith('selector:')) {
        const sel = assertion.slice(9).trim();
        try {
          const count = document.querySelectorAll(sel).length;
          return { assertion, pass: count > 0, detail: `${count} match(es)` };
        } catch { return { assertion, pass: false, detail: 'invalid selector' }; }
      }

      // "contrast:aa" / "contrast:aaa" — cheap WCAG contrast pass/fail with failing element details
      if (lower === 'contrast:aa' || lower === 'contrast:aaa') {
        const level = lower === 'contrast:aaa' ? 'aaa' : 'aa';
        // Local object to avoid named const arrows (esbuild keepNames issue)
        const cc = {
          toLinear(c: number) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); },
          lum(r: number, g: number, b: number) { return 0.2126 * cc.toLinear(r) + 0.7152 * cc.toLinear(g) + 0.0722 * cc.toLinear(b); },
          parse(color: string): [number, number, number] | null {
            const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
            return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
          },
        };

        let checked = 0;
        let eligible = 0;
        let capped = false;
        const failingElements: string[] = [];
        for (const el of document.querySelectorAll('h1,h2,h3,h4,p,a,button,span,li,label')) {
          const t = (el.textContent || '').trim();
          if (!t || t.length < 2) continue;

          // Leaf attribution: skip containers whose text lives entirely in child elements —
          // their children are checked individually, so scoring the wrapper double-counts and
          // tends to report a phantom 1.0:1 against an inherited bg it never renders text on.
          let hasOwnText = false;
          for (const node of el.childNodes) {
            if (node.nodeType === 3 && (node.textContent || '').trim().length >= 2) { hasOwnText = true; break; }
          }
          if (!hasOwnText) continue;

          const style = getComputedStyle(el);
          const fg = cc.parse(style.color);
          if (!fg) continue;

          let bg: [number, number, number] = [255, 255, 255];
          let cur: Element | null = el;
          while (cur) {
            const bgColor = getComputedStyle(cur).backgroundColor;
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
              const parsed = cc.parse(bgColor);
              if (parsed) { bg = parsed; break; }
            }
            cur = cur.parentElement;
          }

          // Un-renderable pair: text color equals resolved bg — skip the phantom 1.0:1.
          if (fg[0] === bg[0] && fg[1] === bg[1] && fg[2] === bg[2]) continue;

          // Eligible candidate; count all so coverage is reported even when capped.
          eligible++;
          if (checked >= contrastLimit) { capped = true; continue; }

          const l1 = cc.lum(...fg);
          const l2 = cc.lum(...bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          const fontSize = parseFloat(style.fontSize);
          const isBold = parseInt(style.fontWeight) >= 700;
          const isLarge = fontSize >= 18 || (fontSize >= 14 && isBold);

          let threshold: number;
          if (level === 'aaa') {
            threshold = isLarge ? 4.5 : 7;
          } else {
            threshold = isLarge ? 3 : 4.5;
          }

          checked++;
          if (ratio < threshold) {
            const tag = el.tagName.toLowerCase();
            const text = t.length > 20 ? t.slice(0, 20) + '...' : t;
            const cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 2).join(' ');
            failingElements.push(`${tag}${cls ? '.' + cls : ''} "${text}" ${ratio.toFixed(1)}:1`);
          }
        }

        const capNote = capped ? ` (sampled ${checked}/${eligible}; ${Math.max(0, eligible - checked)} unchecked — raise with --contrast-limit)` : '';
        if (failingElements.length === 0) {
          return { assertion, pass: true, detail: `all ${checked} elements pass ${level.toUpperCase()}${capNote}` };
        }
        const summary = `${failingElements.length}/${checked} fail ${level.toUpperCase()}`;
        const details = failingElements.join('; ');
        return { assertion, pass: false, detail: `${summary}: ${details}${capNote}` };
      }

      // "no-hscroll" — page must not be wider than the viewport
      if (lower === 'no-hscroll') {
        const vw = window.innerWidth;
        const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
        if (sw > vw) return { assertion, pass: false, detail: `page ${sw}px vs viewport ${vw}px (+${sw - vw}px horizontal scroll)` };
        return { assertion, pass: true, detail: `page ${sw}px fits ${vw}px viewport` };
      }

      // "touch-targets[:N]" — no control smaller than N px (inline text links exempt, WCAG 2.5.8)
      if (lower === 'touch-targets' || lower.startsWith('touch-targets:')) {
        const min = lower.includes(':') ? parseInt(lower.split(':')[1], 10) || 44 : 44;
        const small: string[] = [];
        let checked = 0;
        for (const el of document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"]')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) continue; // sr-only / collapsed
          if (el.tagName === 'A' && cs.display === 'inline') continue; // inline text link — exempt
          checked++;
          if (rect.width < min || rect.height < min) {
            const t = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20);
            small.push(`${el.tagName.toLowerCase()} ${Math.round(rect.width)}x${Math.round(rect.height)}px "${t}"`);
          }
        }
        if (small.length === 0) return { assertion, pass: true, detail: `all ${checked} controls ≥ ${min}px` };
        return { assertion, pass: false, detail: `${small.length}/${checked} controls < ${min}px: ${small.slice(0, 5).join('; ')}${small.length > 5 ? ` … and ${small.length - 5} more` : ''}` };
      }

      // "h1-count[:N]" — exactly N <h1> (rendered or sr-only; display:none excluded)
      if (lower === 'h1-count' || lower.startsWith('h1-count:')) {
        const want = lower.includes(':') ? parseInt(lower.split(':')[1], 10) : 1;
        const h1s = Array.from(document.querySelectorAll('h1')).filter((h) => h.getClientRects().length > 0 && !h.closest('[aria-hidden="true"]'));
        const texts = h1s.map((h) => `"${(h.textContent || '').trim().slice(0, 30)}"`).join(', ');
        return { assertion, pass: h1s.length === want, detail: `${h1s.length} h1 (expected ${want})${texts ? `: ${texts}` : ''}` };
      }

      // "heading-outline" — no skipped levels among screen-reader-visible headings
      if (lower === 'heading-outline') {
        const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) => h.getClientRects().length > 0 && !h.closest('[aria-hidden="true"]'));
        const skips: string[] = [];
        let prev: Element | null = null;
        for (const h of hs) {
          const level = parseInt(h.tagName[1], 10);
          if (prev) {
            const prevLevel = parseInt(prev.tagName[1], 10);
            if (level > prevLevel + 1) {
              skips.push(`h${prevLevel} "${(prev.textContent || '').trim().slice(0, 25)}" → h${level} "${(h.textContent || '').trim().slice(0, 25)}"`);
            }
          }
          prev = h;
        }
        if (skips.length === 0) return { assertion, pass: true, detail: `${hs.length} headings, sequential` };
        return { assertion, pass: false, detail: `${skips.length} skip(s): ${skips.slice(0, 3).join('; ')}` };
      }

      // "no-broken-images" — failed loads only; lazy images that haven't loaded yet are not broken
      if (lower === 'no-broken-images') {
        const broken: string[] = [];
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
          if (!img.complete) continue; // still loading (lazy/off-screen) — unknown, not broken
          if (img.naturalWidth === 0 && (img.currentSrc || img.src)) {
            broken.push((img.currentSrc || img.src).split('/').pop()?.slice(0, 40) || '?');
          }
        }
        if (broken.length === 0) return { assertion, pass: true, detail: `${imgs.length} images ok` };
        return { assertion, pass: false, detail: `${broken.length}/${imgs.length} broken: ${broken.slice(0, 5).join(', ')}` };
      }

      // "alt-text" — every <img> has an alt attribute
      if (lower === 'alt-text') {
        const missing = Array.from(document.querySelectorAll('img:not([alt])'));
        if (missing.length === 0) return { assertion, pass: true, detail: `all ${document.querySelectorAll('img').length} images have alt` };
        const names = missing.slice(0, 5).map((i) => ((i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src || '').split('/').pop()?.slice(0, 40) || '?');
        return { assertion, pass: false, detail: `${missing.length} image(s) without alt: ${names.join(', ')}` };
      }

      // "lang" — <html lang> present
      if (lower === 'lang') {
        const lang = document.documentElement.getAttribute('lang');
        return { assertion, pass: !!lang, detail: lang ? `lang="${lang}"` : 'no lang attribute on <html>' };
      }

      // "canonical" / "meta-description" / OG / twitter
      if (lower === 'canonical') {
        const c = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
        return { assertion, pass: !!c?.href, detail: c?.href ? c.href.slice(0, 80) : 'no <link rel="canonical">' };
      }
      if (lower === 'meta-description') {
        const d = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        return { assertion, pass: d.length > 0, detail: d ? `${d.length} chars` : 'no <meta name="description">' };
      }
      if (lower === 'og-image' || lower === 'og-title' || lower === 'og-tags') {
        const og = (p: string) => document.querySelector(`meta[property="og:${p}"]`)?.getAttribute('content') || '';
        const need = lower === 'og-tags' ? ['title', 'description', 'image'] : [lower.slice(3)];
        const missing = need.filter((p) => !og(p));
        if (missing.length === 0) return { assertion, pass: true, detail: need.map((p) => `og:${p}=${og(p).slice(0, 40)}`).join(', ') };
        return { assertion, pass: false, detail: `missing ${missing.map((p) => `og:${p}`).join(', ')}` };
      }
      if (lower === 'twitter-card') {
        const card = document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') || '';
        return { assertion, pass: !!card, detail: card ? `twitter:card=${card}` : 'no <meta name="twitter:card">' };
      }

      // "class:<name>" — explicit class-substring search (was the implicit fallback)
      if (lower.startsWith('class:')) {
        const name = assertion.slice(6).trim();
        const escaped = name.replace(/[\\"'\]]/g, (ch) => `\\${ch}`);
        try {
          const n = document.querySelectorAll(`[class*="${escaped}"]`).length;
          return { assertion, pass: n > 0, detail: `${n} element(s) with class containing "${name}"` };
        } catch { return { assertion, pass: false, detail: 'invalid class pattern' }; }
      }

      // "translated" — flag untranslated text (identical nodes)
      // This runs as a single-page check: flags text nodes that look like common English
      // phrases on a non-English page (lang attr != "en")
      if (lower === 'translated') {
        const lang = document.documentElement.getAttribute('lang') || '';
        if (!lang || lang.startsWith('en')) {
          return { assertion, pass: true, detail: `lang="${lang}" — skipped (English or no lang)` };
        }
        // Check for common untranslated English patterns
        const commonEnglish = ['read more', 'learn more', 'sign up', 'log in', 'submit', 'subscribe', 'click here', 'contact us', 'get started', 'buy now', 'add to cart'];
        const bodyText = (document.body.textContent || '').toLowerCase();
        const found = commonEnglish.filter((phrase) => bodyText.includes(phrase));
        if (found.length > 0) {
          return { assertion, pass: false, detail: `${found.length} potential untranslated: ${found.join(', ')}` };
        }
        return { assertion, pass: true, detail: `no common English phrases found (lang="${lang}")` };
      }

      // "count:N .selector" — exact element count match
      if (lower.startsWith('count:')) {
        const rest = assertion.slice(6).trim();
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx !== -1) {
          const expected = parseInt(rest.slice(0, spaceIdx), 10);
          const sel = rest.slice(spaceIdx + 1).trim();
          try {
            const actual = document.querySelectorAll(sel).length;
            return { assertion, pass: actual === expected, detail: `found ${actual}, expected ${expected}` };
          } catch { return { assertion, pass: false, detail: 'invalid selector' }; }
        }
        return { assertion, pass: false, detail: 'format: count:N .selector' };
      }

      // Unknown assertion — reported explicitly (never silently coerced into a text search).
      return { assertion, pass: false, detail: 'unknown assertion' };
    });
  }, { checks: domItems, contrastLimit }) : [];

  // Merge results: preserve original assertion order
  const resultMap = new Map<string, CheckResult>();
  for (const r of asyncResults) resultMap.set(r.assertion, r);
  for (const r of domResults) resultMap.set(r.assertion, r);
  const results: CheckResult[] = items.map((item) => {
    const r = resultMap.get(item) ?? { assertion: item, pass: false, detail: 'check not handled' };
    if (!isKnownAssertion(item) || r.detail === 'unknown assertion') {
      return { assertion: item, pass: false, unknown: true, detail: `unknown assertion — known: ${knownAssertionHint()}` };
    }
    return r;
  });

  return { results, allPass: results.every((r) => r.pass), text: formatCheckResults(results) };
}
