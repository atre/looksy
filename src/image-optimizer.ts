import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

const SMALL_WIDTH = 64;
const LARGE_WIDTH = 1080;
const MAX_PROBES = 3;
const PASS_THROUGH_TOLERANCE = 0.02;

const WIDTH_PARAM_RE = /([?&])(w|width)=(\d+)/i;

const KNOWN_OPTIMIZER_HOSTS = [
  /\/_next\/image(\?|$)/,
  /res\.cloudinary\.com/,
  /imgix\.net/,
  /imagedelivery\.net/,
  /\/cdn-cgi\/image\//,
];

export interface ImageOptimizerProbe {
  url: string;
  verdict: 'OK' | 'PASS-THROUGH';
  small: { w: number; bytes: number };
  large: { w: number; bytes: number };
}

export interface ImageOptimizerData {
  probes: ImageOptimizerProbe[];
}

/** True when a URL carries an explicit width query param or matches a known image-optimizer host/path. */
function isOptimizerCandidate(url: string): boolean {
  return WIDTH_PARAM_RE.test(url) || KNOWN_OPTIMIZER_HOSTS.some((re) => re.test(url));
}

/** Same origin+path, ignoring width — two srcset entries for the same image count as one upstream. */
function upstreamKey(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('w');
    u.searchParams.delete('width');
    return `${u.origin}${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return url;
  }
}

/** Rewrite (or append) the w=/width= query param. Only query-string based sizing is rewritten. */
export function rewriteWidth(url: string, w: number): string {
  if (WIDTH_PARAM_RE.test(url)) {
    return url.replace(WIDTH_PARAM_RE, (_m, sep, key) => `${sep}${key}=${w}`);
  }
  return `${url}${url.includes('?') ? '&' : '?'}w=${w}`;
}

/** OK = the optimizer actually resizes (small request is meaningfully smaller); PASS-THROUGH = it doesn't. */
export function judgeOptimizer(small: number, large: number): 'OK' | 'PASS-THROUGH' {
  const denom = Math.max(small, large, 1);
  const diff = Math.abs(large - small) / denom;
  return diff <= PASS_THROUGH_TOLERANCE ? 'PASS-THROUGH' : 'OK';
}

async function fetchBytes(page: Page, url: string): Promise<number> {
  const res = await page.request.get(url);
  const contentLength = res.headers()['content-length'];
  if (contentLength) {
    const n = parseInt(contentLength, 10);
    if (!Number.isNaN(n)) return n;
  }
  const body = await res.body();
  return body.length;
}

/**
 * For up to 3 distinct `?w=`/known-optimizer-host <img> upstreams, fetch the same image at
 * w=64 and w=1080 (via the Playwright request context, sharing the page's cookies/auth) and
 * compare byte sizes to detect optimizers that accept a width param but ignore it (PASS-THROUGH).
 */
export async function extractImageOptimizer(page: Page): Promise<ImageOptimizerData> {
  const srcs: string[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img[src]')).map((img) => (img as HTMLImageElement).src),
  );

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const src of srcs) {
    if (!src || !isOptimizerCandidate(src)) continue;
    const key = upstreamKey(src);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(src);
    if (candidates.length >= MAX_PROBES) break;
  }

  const probes: ImageOptimizerProbe[] = [];
  for (const src of candidates) {
    try {
      const smallUrl = rewriteWidth(src, SMALL_WIDTH);
      const largeUrl = rewriteWidth(src, LARGE_WIDTH);
      const [smallBytes, largeBytes] = await Promise.all([
        fetchBytes(page, smallUrl),
        fetchBytes(page, largeUrl),
      ]);
      probes.push({
        url: src,
        verdict: judgeOptimizer(smallBytes, largeBytes),
        small: { w: SMALL_WIDTH, bytes: smallBytes },
        large: { w: LARGE_WIDTH, bytes: largeBytes },
      });
    } catch {
      // Probe fetch failed (network/CORS/timeout) — skip this candidate silently.
    }
  }

  return { probes };
}

export function formatImageOptimizer(
  data: ImageOptimizerData,
  opts: { compact?: boolean } = {},
): string {
  if (data.probes.length === 0) return '';

  const passThrough = data.probes.filter((p) => p.verdict === 'PASS-THROUGH');

  if (opts.compact) {
    const parts = [`${data.probes.length} checked`];
    parts.push(passThrough.length > 0 ? `${passThrough.length} pass-through` : 'all resizing');
    return `## Image Optimizer: ${parts.join(' | ')}\n`;
  }

  const lines = ['## Image Optimizer\n'];
  lines.push(
    `**${data.probes.length} upstream(s) checked** | ${passThrough.length} pass-through\n`,
  );
  lines.push('| URL | w=64 | w=1080 | Verdict |');
  lines.push('|-----|------|--------|---------|');
  for (const p of data.probes) {
    const name = p.url.length > 60 ? p.url.slice(0, 60) + '...' : p.url;
    const flag = p.verdict === 'PASS-THROUGH' ? ' ⚠' : '';
    lines.push(
      `| ${name} | ${formatBytes(p.small.bytes)} | ${formatBytes(p.large.bytes)} | ${p.verdict}${flag} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
