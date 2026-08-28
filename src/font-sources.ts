import type { Page } from 'playwright';

export interface FontSource {
  url: string;
  family: string;
  format: string;
  /** Whether the font is loaded from an external CDN (e.g. Google Fonts) */
  external: boolean;
}

export interface FontSourcesData {
  sources: FontSource[];
  /** External CDN domains detected (e.g. fonts.googleapis.com) */
  externalDomains: string[];
}

/**
 * Extract all font source URLs — from @font-face rules in stylesheets
 * and from network resource entries. Useful for detecting font fingerprinting
 * (same Google Fonts URLs across multiple sites).
 */
export async function extractFontSources(page: Page): Promise<FontSourcesData> {
  return await page.evaluate(() => {
    const sources: Array<{ url: string; family: string; format: string; external: boolean }> = [];
    const seen = new Set<string>();
    const pageHost = location.hostname;

    // 1. Extract from @font-face rules in stylesheets
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSFontFaceRule) {
            const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
            const src = rule.style.getPropertyValue('src');
            // Parse url() references
            const urlMatches = src.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g);
            for (const m of urlMatches) {
              const url = m[1];
              if (seen.has(url)) continue;
              seen.add(url);
              const format = url.match(/\.(woff2?|ttf|otf|eot|svg)(\?|$)/i)?.[1] || 'unknown';
              let external = false;
              try {
                const u = new URL(url, location.href);
                external = u.hostname !== pageHost;
              } catch { /* relative URL = not external */ }
              sources.push({ url, family, format, external });
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip
      }
    }

    // 2. Also check network resource entries for font downloads
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const e of entries) {
      if (e.initiatorType === 'css' || e.initiatorType === 'link') {
        const isFont = /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(e.name);
        if (isFont && !seen.has(e.name)) {
          seen.add(e.name);
          const format = e.name.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)?.[1] || 'unknown';
          let external = false;
          try {
            const u = new URL(e.name);
            external = u.hostname !== pageHost;
          } catch { /* skip */ }
          sources.push({ url: e.name, family: '', format, external });
        }
      }
    }

    // 3. Check for Google Fonts / other CDN stylesheet links
    const fontStylesheets: string[] = [];
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const href = (link as HTMLLinkElement).href;
      if (href && (href.includes('fonts.googleapis.com') || href.includes('fonts.bunny.net') || href.includes('use.typekit.net'))) {
        fontStylesheets.push(href);
      }
    }
    // Add CDN stylesheet URLs as sources too
    for (const url of fontStylesheets) {
      if (!seen.has(url)) {
        seen.add(url);
        sources.push({ url, family: '', format: 'stylesheet', external: true });
      }
    }

    const externalDomains = [...new Set(
      sources.filter((s) => s.external).map((s) => {
        try { return new URL(s.url).hostname; } catch { return ''; }
      }).filter(Boolean),
    )];

    return { sources, externalDomains };
  });
}

export function formatFontSources(data: FontSourcesData, opts: { compact?: boolean } = {}): string {
  if (data.sources.length === 0) return '## Font Sources: no font files detected\n';

  const external = data.sources.filter((s) => s.external);

  if (opts.compact) {
    const domains = data.externalDomains.length > 0
      ? ` | external: ${data.externalDomains.join(', ')}`
      : ' | all self-hosted';
    return `## Font Sources (${data.sources.length}): ${data.sources.map((s) => s.family || s.url.split('/').pop()?.split('?')[0] || s.url).join(', ')}${domains}\n`;
  }

  const lines = ['## Font Sources\n'];
  lines.push(`**${data.sources.length} font files** — ${external.length} external, ${data.sources.length - external.length} self-hosted\n`);

  if (data.externalDomains.length > 0) {
    lines.push(`**External domains:** ${data.externalDomains.join(', ')}\n`);
  }

  lines.push('| Family | Format | External | URL |');
  lines.push('|--------|--------|----------|-----|');
  for (const s of data.sources) {
    const url = s.url.length > 60 ? s.url.slice(0, 60) + '...' : s.url;
    lines.push(`| ${s.family || '—'} | ${s.format} | ${s.external ? 'Yes' : 'No'} | ${url} |`);
  }
  lines.push('');

  return lines.join('\n');
}
