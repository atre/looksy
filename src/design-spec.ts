import type { Page } from 'playwright';
import { readFileSync } from 'node:fs';

export interface DesignSpec {
  fonts?: Record<string, string>;      // selector → expected font family
  colors?: Record<string, string>;     // "selector [bg]" → expected hex color
  spacing?: Record<string, string>;    // "selector property" → expected value
}

export interface DesignValidationResult {
  assertion: string;
  category: 'font' | 'color' | 'spacing';
  selector: string;
  property: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/**
 * Load a design spec file.
 * JSON format:
 * {
 *   "fonts": { "h1": "Archivo Black", "body": "DM Sans", ".price": "DM Mono" },
 *   "colors": { ".hero-section bg": "#3D3D3D", "h1": "#3D3D3D", ".btn-primary bg": "#5A6D52" },
 *   "spacing": { "section padding-top": "64px", ".container max-width": "1200px" }
 * }
 */
export function loadDesignSpec(specPath: string): DesignSpec {
  const raw = readFileSync(specPath, 'utf-8');
  const data = JSON.parse(raw);
  if (typeof data !== 'object' || data === null) {
    throw new Error('Design spec must be a JSON object');
  }
  if (data.fonts && typeof data.fonts !== 'object') throw new Error('Design spec "fonts" must be an object');
  if (data.colors && typeof data.colors !== 'object') throw new Error('Design spec "colors" must be an object');
  if (data.spacing && typeof data.spacing !== 'object') throw new Error('Design spec "spacing" must be an object');
  return data;
}

/**
 * Validate a page against a design spec. Runs all checks in a single page.evaluate.
 */
export async function validateDesign(page: Page, spec: DesignSpec): Promise<DesignValidationResult[]> {
  interface Check {
    category: 'font' | 'color' | 'spacing';
    selector: string;
    property: string;
    expected: string;
    assertion: string;
  }

  const checks: Check[] = [];

  if (spec.fonts) {
    for (const [sel, expected] of Object.entries(spec.fonts)) {
      checks.push({ category: 'font', selector: sel, property: 'font-family', expected, assertion: `font ${sel} = ${expected}` });
    }
  }

  if (spec.colors) {
    for (const [key, expected] of Object.entries(spec.colors)) {
      const parts = key.trim().split(/\s+/);
      const lastWord = parts[parts.length - 1].toLowerCase();
      let selector: string, property: string;

      if (lastWord === 'bg' || lastWord === 'background' || lastWord === 'background-color') {
        selector = parts.slice(0, -1).join(' ');
        property = 'background-color';
      } else if (lastWord === 'color') {
        selector = parts.slice(0, -1).join(' ');
        property = 'color';
      } else {
        selector = key;
        property = 'color';
      }

      checks.push({ category: 'color', selector, property, expected, assertion: `${property} ${selector} = ${expected}` });
    }
  }

  if (spec.spacing) {
    for (const [key, expected] of Object.entries(spec.spacing)) {
      const parts = key.trim().split(/\s+/);
      const property = parts[parts.length - 1];
      const selector = parts.slice(0, -1).join(' ');
      checks.push({ category: 'spacing', selector, property, expected, assertion: `${selector} ${property} = ${expected}` });
    }
  }

  if (checks.length === 0) {
    return [];
  }

  const results = await page.evaluate((checksData: Check[]) => {
    // Object method pattern to avoid named functions inside evaluate
    // (esbuild keepNames wraps standalone named bindings with __name() which breaks in browser context)
    const $ = {
      rgbToHex(color: string): string {
        const m = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return color;
        return '#' + [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])].map(c => c.toString(16).padStart(2, '0')).join('');
      },
      parseHex(h: string): [number, number, number] | null {
        if (/^#[0-9a-fA-F]{6}$/i.test(h)) return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        if (/^#[0-9a-fA-F]{3}$/i.test(h)) return [parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), parseInt(h[3] + h[3], 16)];
        return null;
      },
      colorsMatch(computed: string, expected: string, tolerance = 5): boolean {
        const a = $.parseHex($.rgbToHex(computed));
        const b = $.parseHex(expected);
        if (!a || !b) return $.rgbToHex(computed).toLowerCase() === expected.toLowerCase();
        return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance && Math.abs(a[2] - b[2]) <= tolerance;
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
    };

    return checksData.map(check => {
      try {
        const el = document.querySelector(check.selector);
        if (!el) {
          return { ...check, actual: 'not found', pass: false };
        }

        const cs = getComputedStyle(el);

        if (check.category === 'font') {
          const actual = cs.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
          const pass = actual.toLowerCase() === check.expected.toLowerCase() ||
                       cs.fontFamily.toLowerCase().includes(check.expected.toLowerCase());
          return { ...check, actual, pass };
        }

        if (check.category === 'color') {
          let computed: string;
          if (check.property === 'background-color') {
            computed = $.resolveBg(el);
          } else {
            computed = cs.getPropertyValue(check.property);
          }
          const actual = $.rgbToHex(computed);
          const pass = $.colorsMatch(computed, check.expected);
          return { ...check, actual, pass };
        }

        // Spacing
        const actual = cs.getPropertyValue(check.property);
        const pass = actual === check.expected;
        return { ...check, actual, pass };
      } catch {
        return { ...check, actual: 'error', pass: false };
      }
    });
  }, checks);

  return results;
}

export function formatDesignValidation(results: DesignValidationResult[], opts: { compact?: boolean } = {}): string {
  const failures = results.filter(r => !r.pass);

  if (opts.compact) {
    if (failures.length === 0) return `Design spec: all ${results.length} checks pass\n`;
    const lines = [`Design spec: ${failures.length}/${results.length} fail`];
    for (const f of failures) {
      lines.push(`- [FAIL] ${f.selector} ${f.property}: ${f.actual} (expected ${f.expected})`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## Design Spec Validation\n'];

  for (const category of ['font', 'color', 'spacing'] as const) {
    const catResults = results.filter(r => r.category === category);
    if (catResults.length === 0) continue;

    lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}s\n`);
    for (const r of catResults) {
      const icon = r.pass ? 'PASS' : 'FAIL';
      const detail = r.pass ? r.actual : `${r.actual} (expected ${r.expected})`;
      lines.push(`- [${icon}] \`${r.selector}\` ${r.property}: ${detail}`);
    }
    lines.push('');
  }

  const summary = failures.length === 0
    ? `All ${results.length} design spec checks pass.`
    : `${failures.length}/${results.length} design spec checks failed.`;
  lines.push(summary);
  lines.push('');

  return lines.join('\n');
}
