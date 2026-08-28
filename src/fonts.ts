import type { Page } from 'playwright';

export interface FontInfo {
  family: string;
  weight: string;
  style: string;
  // FontFaceSet status: 'loaded' (fetched + ready) | 'loading' | 'error' (fetch failed) |
  // 'unloaded' (declared via @font-face but the browser never requested it because no
  // rendered text used this exact family/weight/style at capture time — lazy, not an error).
  status: string;
}

/** Human-readable explanation of a non-obvious FontFaceSet status. */
const UNLOADED_NOTE =
  'unloaded = declared via @font-face but not requested by the browser at capture (no rendered text used this face) — lazy loading, not an error';

/**
 * Extract font loading status using the document.fonts API (FontFaceSet).
 */
export async function extractFonts(page: Page): Promise<FontInfo[]> {
  return await page.evaluate(() => {
    const fonts: { family: string; weight: string; style: string; status: string }[] = [];
    const seen = new Set<string>();

    for (const face of document.fonts) {
      const key = `${face.family}-${face.weight}-${face.style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fonts.push({
        family: face.family.replace(/['"]/g, ''),
        weight: face.weight,
        style: face.style,
        status: face.status,
      });
    }

    return fonts.slice(0, 30);
  });
}

export function formatFonts(fonts: FontInfo[], opts: { compact?: boolean } = {}): string {
  if (fonts.length === 0) return '## Fonts: no web fonts detected\n';

  const errors = fonts.filter((f) => f.status === 'error');
  const hasUnloaded = fonts.some((f) => f.status === 'unloaded');

  if (opts.compact) {
    const summary = fonts.map((f) => `${f.family} ${f.weight}${f.status !== 'loaded' ? ` [${f.status}]` : ''}`).join(', ');
    const warn = errors.length > 0 ? ` — ${errors.length} failed` : '';
    const note = hasUnloaded ? `\n  (${UNLOADED_NOTE})` : '';
    return `## Fonts (${fonts.length}): ${summary}${warn}${note}\n`;
  }

  const lines = ['## Font Loading\n'];
  lines.push('| Family | Weight | Style | Status |');
  lines.push('|--------|--------|-------|--------|');
  for (const f of fonts) {
    const status = f.status === 'loaded' ? 'Loaded'
      : f.status === 'error' ? '**ERROR**'
      : f.status === 'unloaded' ? 'unloaded (declared, not rendered)'
      : f.status;
    lines.push(`| ${f.family} | ${f.weight} | ${f.style} | ${status} |`);
  }
  lines.push('');
  if (errors.length > 0) {
    lines.push(`**${errors.length} font(s) failed to load.**`);
  }
  if (hasUnloaded) {
    lines.push(`_${UNLOADED_NOTE}._`);
  }
  lines.push('');
  return lines.join('\n');
}
