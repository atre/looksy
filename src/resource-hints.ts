import type { Page } from 'playwright';

export interface ResourceHint {
  rel: string;
  href: string;
  as?: string;
  crossorigin?: string;
}

export interface ResourceHintsData {
  existing: ResourceHint[];
  missingPreconnects: string[];
  unusedPreloads: string[];
  missingPreloads: { type: string; url: string; reason: string }[];
}

/** Extract resource hints and suggest improvements. */
export async function extractResourceHints(page: Page): Promise<ResourceHintsData> {
  return await page.evaluate(() => {
    // Existing hints
    const hintLinks = Array.from(document.querySelectorAll('link[rel="preload"], link[rel="prefetch"], link[rel="preconnect"], link[rel="dns-prefetch"]'));
    const existing: ResourceHint[] = hintLinks.map(l => ({
      rel: l.getAttribute('rel') || '',
      href: l.getAttribute('href') || '',
      as: l.getAttribute('as') || undefined,
      crossorigin: l.getAttribute('crossorigin') || undefined,
    }));

    // All external origins from resources
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const pageOrigin = window.location.origin;
    const externalOrigins = new Set<string>();
    for (const r of resources) {
      try {
        const origin = new URL(r.name).origin;
        if (origin !== pageOrigin) externalOrigins.add(origin);
      } catch { /* skip invalid URLs */ }
    }

    // Existing preconnect origins
    const preconnectOrigins = new Set(
      existing
        .filter(h => h.rel === 'preconnect' || h.rel === 'dns-prefetch')
        .map(h => { try { return new URL(h.href).origin; } catch { return ''; } })
        .filter(Boolean)
    );

    // Missing preconnects (external origins not preconnected)
    const missingPreconnects = Array.from(externalOrigins).filter(o => !preconnectOrigins.has(o));

    // Preloaded URLs
    const preloadedUrls = new Set(existing.filter(h => h.rel === 'preload').map(h => h.href));

    // Consumed URLs — check which preloads were actually used
    const resourceUrls = new Set(resources.map(r => r.name));
    const unusedPreloads = Array.from(preloadedUrls).filter(url => !resourceUrls.has(url));

    // LCP element check — should its resource be preloaded?
    const missingPreloads: { type: string; url: string; reason: string }[] = [];
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint') as any[];
    if (lcpEntries.length > 0) {
      const last = lcpEntries[lcpEntries.length - 1];
      if (last.url && !preloadedUrls.has(last.url)) {
        missingPreloads.push({
          type: 'LCP image',
          url: last.url,
          reason: 'LCP element resource should be preloaded for faster rendering',
        });
      }
    }

    // Check for critical fonts not preloaded
    const fontResources = resources.filter(r =>
      /\.(woff2?|ttf|otf)(\?|$)/i.test(r.name) && r.startTime < 2000
    );
    for (const font of fontResources) {
      if (!preloadedUrls.has(font.name)) {
        const name = font.name.split('/').pop()?.split('?')[0] || font.name;
        missingPreloads.push({
          type: 'critical font',
          url: name,
          reason: 'Font loaded early — preload to avoid FOIT/FOUT',
        });
      }
    }

    return { existing, missingPreconnects, unusedPreloads, missingPreloads };
  });
}

export function formatResourceHints(data: ResourceHintsData, opts: { compact?: boolean } = {}): string {
  const totalIssues = data.missingPreconnects.length + data.unusedPreloads.length + data.missingPreloads.length;

  if (opts.compact) {
    const parts = [`${data.existing.length} hints`];
    if (totalIssues > 0) parts.push(`${totalIssues} suggestions`);
    else parts.push('no suggestions');
    return `## Resource Hints: ${parts.join(' | ')}\n`;
  }

  const lines = ['## Resource Hints\n'];

  // Existing hints
  if (data.existing.length > 0) {
    lines.push('### Existing Hints\n');
    lines.push('| Rel | Href | As |');
    lines.push('|-----|------|----|');
    for (const h of data.existing) {
      const href = h.href.length > 50 ? '...' + h.href.slice(-47) : h.href;
      lines.push(`| ${h.rel} | ${href} | ${h.as || '—'} |`);
    }
    lines.push('');
  } else {
    lines.push('No resource hints found.\n');
  }

  // Missing preconnects
  if (data.missingPreconnects.length > 0) {
    lines.push('### Missing Preconnects\n');
    lines.push('Third-party origins without `<link rel="preconnect">`:\n');
    for (const origin of data.missingPreconnects.slice(0, 10)) {
      lines.push(`- \`<link rel="preconnect" href="${origin}">\``);
    }
    lines.push('');
  }

  // Unused preloads
  if (data.unusedPreloads.length > 0) {
    lines.push('### Unused Preloads ⚠\n');
    lines.push('Preloaded but never consumed (wasted bandwidth):\n');
    for (const url of data.unusedPreloads) {
      const name = url.split('/').pop()?.split('?')[0] || url;
      lines.push(`- ${name}`);
    }
    lines.push('');
  }

  // Missing preloads
  if (data.missingPreloads.length > 0) {
    lines.push('### Suggested Preloads\n');
    for (const mp of data.missingPreloads) {
      const name = mp.url.split('/').pop()?.split('?')[0] || mp.url;
      lines.push(`- **${mp.type}:** ${name} — ${mp.reason}`);
    }
    lines.push('');
  }

  if (totalIssues === 0) {
    lines.push('No issues found. ✓\n');
  }

  lines.push('');
  return lines.join('\n');
}
