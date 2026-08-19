import type { Page } from 'playwright';

export interface LinkResult {
  url: string;
  text: string;
  status: number | null;
  ok: boolean;
  verdict: 'ok' | 'broken' | 'unverifiable';
  error?: string;
}

/** Hosts known to block automated HEAD/GET requests (403/999) regardless of link validity. */
const BOT_BLOCKED_HOSTS = ['linkedin.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com'];

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/**
 * Classify a link check result into ok/broken/unverifiable. Statuses that commonly reflect
 * bot-blocking rather than a dead link (403/429/999) or hosts known to block scrapers never
 * count as broken.
 */
export function classifyLink(
  status: number | null,
  host: string,
  allow: string[],
): 'ok' | 'broken' | 'unverifiable' {
  if (allow.some((suffix) => hostMatches(host, suffix))) return 'unverifiable';
  if (BOT_BLOCKED_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'unverifiable';
  if (status === 403 || status === 429 || status === 999) return 'unverifiable';
  if (status !== null && status >= 200 && status < 400) return 'ok';
  return 'broken';
}

/**
 * Extract all <a href> links and HEAD-request each to find broken ones.
 * Concurrency-limited to 5 parallel requests, 5s timeout each.
 */
export async function checkLinks(
  page: Page,
  opts: { allow?: string[] } = {},
): Promise<LinkResult[]> {
  const allow = opts.allow ?? [];
  const links = await page.evaluate(() => {
    const results: { url: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const a of document.querySelectorAll('a[href]')) {
      const anchor = a as HTMLAnchorElement;
      const href = anchor.href;
      if (
        !href ||
        seen.has(href) ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:')
      )
        continue;
      seen.add(href);
      results.push({ url: href, text: (anchor.textContent || '').trim().slice(0, 40) });
    }
    return results.slice(0, 50);
  });

  // HEAD request with concurrency limit
  const CONCURRENCY = 5;
  const TIMEOUT = 5000;
  const results: LinkResult[] = [];

  function toResult(url: string, text: string, status: number | null, error?: string): LinkResult {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // malformed URL — host stays empty, classifyLink falls through to status-based rules
    }
    const verdict = classifyLink(status, host, allow);
    return { url, text, status, ok: verdict === 'ok', verdict, ...(error ? { error } : {}) };
  }

  async function checkOne(link: { url: string; text: string }): Promise<LinkResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      const res = await fetch(link.url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      return toResult(link.url, link.text, res.status);
    } catch (err: any) {
      // Retry with GET for servers that reject HEAD
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT);
        const res = await fetch(link.url, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timer);
        return toResult(link.url, link.text, res.status);
      } catch (getErr: any) {
        return toResult(link.url, link.text, null, getErr.message?.slice(0, 60) || 'fetch failed');
      }
    }
  }

  // Process in batches
  for (let i = 0; i < links.length; i += CONCURRENCY) {
    const batch = links.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkOne));
    results.push(...batchResults);
  }

  return results;
}

export function formatLinks(links: LinkResult[], opts: { compact?: boolean } = {}): string {
  const broken = links.filter((l) => l.verdict === 'broken');
  const unverifiable = links.filter((l) => l.verdict === 'unverifiable');

  if (opts.compact) {
    const lines: string[] = [];
    if (broken.length === 0 && unverifiable.length === 0) {
      return `## Links: ${links.length} checked, all OK\n`;
    }
    lines.push(`## Links: ${broken.length}/${links.length} broken`);
    for (const l of broken) {
      lines.push(`- ${l.status || 'ERR'} ${l.url.slice(0, 60)}${l.error ? ` (${l.error})` : ''}`);
    }
    if (unverifiable.length > 0) {
      lines.push(`### Unverifiable (${unverifiable.length})`);
      for (const l of unverifiable) {
        lines.push(`- ${l.status || 'ERR'} ${l.url.slice(0, 60)}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## Link Check\n'];
  lines.push(
    `**${links.length} links checked** — ${broken.length} broken, ${unverifiable.length} unverifiable\n`,
  );

  if (broken.length > 0) {
    lines.push('### Broken Links\n');
    lines.push('| URL | Status | Error |');
    lines.push('|-----|--------|-------|');
    for (const l of broken) {
      const url = l.url.length > 50 ? l.url.slice(0, 50) + '...' : l.url;
      lines.push(`| ${url} | ${l.status || '—'} | ${l.error || `HTTP ${l.status}`} |`);
    }
    lines.push('');
  } else {
    lines.push('No broken links found.\n');
  }

  if (unverifiable.length > 0) {
    lines.push(`### Unverifiable (${unverifiable.length})\n`);
    lines.push('| URL | Status |');
    lines.push('|-----|--------|');
    for (const l of unverifiable) {
      const url = l.url.length > 50 ? l.url.slice(0, 50) + '...' : l.url;
      lines.push(`| ${url} | ${l.status || '—'} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
