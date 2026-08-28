import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface ThirdPartyEntry {
  origin: string;
  category: 'analytics' | 'payment' | 'error-tracking' | 'fonts' | 'cdn' | 'social' | 'ads' | 'other';
  requestCount: number;
  totalTransferSize: number;
  totalDuration: number;
  renderBlocking: number;
  scripts: { name: string; async: boolean; defer: boolean; transferSize: number }[];
}

export interface ThirdPartyData {
  entries: ThirdPartyEntry[];
  firstPartyOrigin: string;
  thirdPartyCount: number;
  thirdPartySize: number;
  renderBlockingCount: number;
}

/** Known third-party domain patterns → category. */
const CATEGORY_PATTERNS: [RegExp, ThirdPartyEntry['category']][] = [
  [/google-analytics|googletagmanager|analytics|plausible|fathom|umami|segment|mixpanel|hotjar|amplitude/, 'analytics'],
  [/stripe|paypal|braintree|square/, 'payment'],
  [/sentry|bugsnag|rollbar|datadog|logrocket/, 'error-tracking'],
  [/fonts\.googleapis|fonts\.gstatic|fonts\.bunny|typekit|use\.fontawesome/, 'fonts'],
  [/cdnjs|unpkg|jsdelivr|cloudflare|fastly|akamai|cloudfront/, 'cdn'],
  [/facebook|twitter|linkedin|instagram|pinterest|tiktok/, 'social'],
  [/doubleclick|googlesyndication|adnxs|criteo/, 'ads'],
];

function categorizeOrigin(origin: string): ThirdPartyEntry['category'] {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(origin)) return category;
  }
  return 'other';
}

/** Extract third-party resource data grouped by origin. */
export async function extractThirdParty(page: Page): Promise<ThirdPartyData> {
  const pageOrigin = await page.evaluate(() => window.location.origin);

  const raw = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources
      .filter(r => r.name.startsWith('http://') || r.name.startsWith('https://'))
      .map(r => ({
        url: r.name,
        origin: new URL(r.name).origin,
        name: r.name.split('/').pop()?.split('?')[0] || r.name,
        type: r.initiatorType,
        transferSize: r.transferSize || 0,
        duration: Math.round(r.duration),
        renderBlocking: (r as any).renderBlockingStatus === 'blocking',
      }));
  });

  // Get script tags info (async/defer)
  const scriptInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]')).map(s => ({
      src: (s as HTMLScriptElement).src,
      async: (s as HTMLScriptElement).async,
      defer: (s as HTMLScriptElement).defer,
    }));
  });
  const scriptMap = new Map(scriptInfo.map(s => [s.src, s]));

  // Group by origin
  const originMap = new Map<string, {
    requests: typeof raw;
    scripts: { name: string; async: boolean; defer: boolean; transferSize: number }[];
  }>();

  for (const r of raw) {
    if (r.origin === pageOrigin) continue; // skip first-party
    const entry = originMap.get(r.origin) || { requests: [], scripts: [] };
    entry.requests.push(r);
    if (r.type === 'script') {
      const info = scriptMap.get(r.url);
      entry.scripts.push({
        name: r.name,
        async: info?.async ?? false,
        defer: info?.defer ?? false,
        transferSize: r.transferSize,
      });
    }
    originMap.set(r.origin, entry);
  }

  const entries: ThirdPartyEntry[] = Array.from(originMap.entries()).map(([origin, data]) => ({
    origin,
    category: categorizeOrigin(origin),
    requestCount: data.requests.length,
    totalTransferSize: data.requests.reduce((s, r) => s + r.transferSize, 0),
    totalDuration: Math.max(...data.requests.map(r => r.duration), 0),
    renderBlocking: data.requests.filter(r => r.renderBlocking).length,
    scripts: data.scripts,
  }));

  entries.sort((a, b) => b.totalTransferSize - a.totalTransferSize);

  const thirdPartySize = entries.reduce((s, e) => s + e.totalTransferSize, 0);
  const renderBlockingCount = entries.reduce((s, e) => s + e.renderBlocking, 0);

  return {
    entries,
    firstPartyOrigin: pageOrigin,
    thirdPartyCount: entries.length,
    thirdPartySize,
    renderBlockingCount,
  };
}

export function formatThirdParty(data: ThirdPartyData, opts: { compact?: boolean } = {}): string {
  if (data.entries.length === 0) return '## Third-Party: No third-party resources\n';

  if (opts.compact) {
    const parts = [
      `${data.thirdPartyCount} origins`,
      `${formatBytes(data.thirdPartySize)}`,
    ];
    if (data.renderBlockingCount > 0) parts.push(`${data.renderBlockingCount} render-blocking ⚠`);
    return `## Third-Party: ${parts.join(' | ')}\n`;
  }

  const lines = ['## Third-Party Resources\n'];
  lines.push(`**${data.thirdPartyCount} third-party origins** | ${formatBytes(data.thirdPartySize)} total`);
  if (data.renderBlockingCount > 0) {
    lines.push(` | **${data.renderBlockingCount} render-blocking** ⚠`);
  }
  lines.push('\n');

  lines.push('| Origin | Category | Requests | Size | Slowest | Blocking |');
  lines.push('|--------|----------|----------|------|---------|----------|');
  for (const e of data.entries.slice(0, 20)) {
    const host = e.origin.replace(/^https?:\/\//, '');
    const hostShort = host.length > 30 ? host.slice(0, 30) + '...' : host;
    const blocking = e.renderBlocking > 0 ? `${e.renderBlocking} ⚠` : '—';
    lines.push(`| ${hostShort} | ${e.category} | ${e.requestCount} | ${formatBytes(e.totalTransferSize)} | ${e.totalDuration}ms | ${blocking} |`);
  }

  // Script loading details
  const withScripts = data.entries.filter(e => e.scripts.length > 0);
  if (withScripts.length > 0) {
    lines.push('');
    lines.push('### Script Loading\n');
    for (const entry of withScripts.slice(0, 10)) {
      const host = entry.origin.replace(/^https?:\/\//, '');
      for (const s of entry.scripts.slice(0, 5)) {
        const mode = s.async ? 'async' : s.defer ? 'defer' : 'sync ⚠';
        lines.push(`- ${host}/${s.name} (${mode}, ${formatBytes(s.transferSize)})`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
