import type { Page } from 'playwright';

export interface CssVar {
  name: string;
  value: string;
}

/**
 * Extract CSS custom properties (--*) from :root and html rules.
 */
export async function extractCssVars(page: Page): Promise<CssVar[]> {
  return await page.evaluate(() => {
    const vars: { name: string; value: string }[] = [];
    const seen = new Set<string>();

    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule) {
            const sel = rule.selectorText;
            if (sel === ':root' || sel === 'html' || sel === ':root, :host') {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--') && !seen.has(prop)) {
                  seen.add(prop);
                  vars.push({ name: prop, value: rule.style.getPropertyValue(prop).trim() });
                }
              }
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip
      }
    }

    // Also get computed :root vars if nothing found in sheets
    if (vars.length === 0) {
      const rootStyle = getComputedStyle(document.documentElement);
      for (let i = 0; i < rootStyle.length; i++) {
        const prop = rootStyle[i];
        if (prop.startsWith('--') && !seen.has(prop)) {
          seen.add(prop);
          vars.push({ name: prop, value: rootStyle.getPropertyValue(prop).trim() });
        }
      }
    }

    return vars.slice(0, 50);
  });
}

export function formatCssVars(vars: CssVar[], opts: { compact?: boolean } = {}): string {
  if (vars.length === 0) return '## CSS Vars: none found\n';

  if (opts.compact) {
    return `## CSS Vars (${vars.length}): ${vars.map((v) => `${v.name}=${v.value}`).join(' | ')}\n`;
  }

  const lines = ['## CSS Custom Properties\n'];
  lines.push('| Variable | Value |');
  lines.push('|----------|-------|');
  for (const v of vars) {
    lines.push(`| \`${v.name}\` | \`${v.value}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}
