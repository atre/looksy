import type { Page } from 'playwright';

/**
 * Design token audit: search DOM for elements matching a CSS class or
 * computed value pattern. Returns count + element selectors/locations.
 * Useful after design system migrations to verify deprecated tokens are gone.
 */
export async function runAudit(page: Page, pattern: string): Promise<string> {
  const data = await page.evaluate((searchPattern: string) => {
    const results: { selector: string; matchType: string; value: string; rect: { x: number; y: number } }[] = [];

    // Object method pattern to avoid named function/const inside evaluate
    // (esbuild keepNames wraps standalone named bindings with __name() which breaks in browser context)
    const $ = { sel(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className ? `.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
      return `${tag}${id}${cls}`;
    } };

    // Search in class attributes (escaped to prevent CSS selector injection)
    const escaped = searchPattern.replace(/[\\"'\]]/g, (ch) => `\\${ch}`);
    let byClass: NodeListOf<Element>;
    try { byClass = document.querySelectorAll(`[class*="${escaped}"]`); } catch { byClass = document.querySelectorAll('_never_'); }
    for (const el of byClass) {
      if (results.length >= 50) break;
      const rect = el.getBoundingClientRect();
      results.push({
        selector: $.sel(el),
        matchType: 'class',
        value: String(el.className).split(' ').filter((c) => c.includes(searchPattern)).join(', '),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y) },
      });
    }

    // Search in inline styles (escaped to prevent CSS selector injection)
    let byStyle: NodeListOf<Element>;
    try { byStyle = document.querySelectorAll(`[style*="${escaped}"]`); } catch { byStyle = document.querySelectorAll('_never_'); }
    for (const el of byStyle) {
      if (results.length >= 50) break;
      const existing = results.find((r) => r.selector === $.sel(el));
      if (existing) continue;
      const rect = el.getBoundingClientRect();
      const style = el.getAttribute('style') ?? '';
      results.push({
        selector: $.sel(el),
        matchType: 'inline-style',
        value: style.slice(0, 100),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y) },
      });
    }

    // Search computed styles for color/border patterns that look like design tokens
    // Only check if pattern looks like a color or CSS value
    if (searchPattern.match(/^(#|rgb|hsl|border|color|background|font)/i)) {
      for (const el of document.querySelectorAll('*')) {
        if (results.length >= 50) break;
        const cs = getComputedStyle(el);
        const propsToCheck = ['color', 'background-color', 'border-color', 'border-top-color',
          'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color'];
        for (const prop of propsToCheck) {
          const val = cs.getPropertyValue(prop);
          if (val && val.includes(searchPattern)) {
            const existing = results.find((r) => r.selector === $.sel(el));
            if (existing) continue;
            const rect = el.getBoundingClientRect();
            results.push({
              selector: $.sel(el),
              matchType: `computed-${prop}`,
              value: val,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y) },
            });
          }
        }
      }
    }

    return results;
  }, pattern);

  const lines: string[] = [];

  if (data.length === 0) {
    lines.push(`## Audit: "${pattern}" — 0 matches`);
    lines.push('');
    lines.push('Pattern not found in any element classes, inline styles, or computed values.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`## Audit: "${pattern}" — ${data.length} match(es)`);
  lines.push('');
  for (const r of data) {
    lines.push(`- \`${r.selector}\` [${r.rect.x},${r.rect.y}] ${r.matchType}: ${r.value}`);
  }
  lines.push('');

  return lines.join('\n');
}
