import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface CacheEntry {
  name: string;
  url: string;
  type: string;
  transferSize: number;
  cacheControl: string;
  encoding: string;
  ttl: number | null; // seconds, null if no caching
  issue: string | null;
}

export interface CacheAuditData {
  entries: CacheEntry[];
  totalResources: number;
  noCacheCount: number;
  shortTtlCount: number;
  immutableCount: number;
  issues: { severity: 'high' | 'medium' | 'low'; message: string }[];
}

/** Per-URL response headers relevant to cache classification, captured live via page.on('response'). */
export interface CacheHeaderInfo {
  cacheControl?: string;
  age?: string;
  cfCacheStatus?: string;
}

export interface CacheClassifyEntry {
  name: string;
  transferSize: number;
  decodedBodySize?: number;
  isHashed?: boolean;
  isStatic?: boolean;
  isHtml?: boolean;
}

export interface CacheClassification {
  cacheControl: string;
  ttl: number | null;
  issue: string | null;
}

const THIRTY_DAYS = 2592000;
const ONE_DAY = 86400;

/**
 * Pure classification: header (when we actually saw a cache-control response header) is
 * authoritative and replaces the transferSize=0 heuristic entirely for that entry. Only when
 * no header was observed at all do we fall back to inferring from transfer/decoded size —
 * and even then, a 0/0 entry (opaque/aborted/redirect) is left as 'unknown', never counted.
 */
export function classifyCacheEntry(
  entry: CacheClassifyEntry,
  header: string | undefined,
): CacheClassification {
  const transferSize = entry.transferSize ?? 0;
  const decodedBodySize = entry.decodedBodySize ?? 0;

  if (transferSize === 0 && decodedBodySize === 0) {
    return { cacheControl: 'unknown', ttl: null, issue: null };
  }

  if (header) {
    const maxAgeMatch = header.match(/max-age=(\d+)/i);
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : null;
    const immutable = /immutable/i.test(header);

    if (immutable || (maxAge !== null && maxAge >= THIRTY_DAYS)) {
      return { cacheControl: 'immutable (cached)', ttl: maxAge ?? 31536000, issue: null };
    }
    if (entry.isHashed && maxAge !== null && maxAge < ONE_DAY) {
      const hours = Math.max(1, Math.round(maxAge / 3600));
      return { cacheControl: header, ttl: maxAge, issue: `hashed asset short-ttl (${hours}h)` };
    }
    if (entry.isHtml && /no-store|no-cache/i.test(header)) {
      return { cacheControl: 'no-cache', ttl: 0, issue: null };
    }
    return { cacheControl: header, ttl: maxAge, issue: null };
  }

  // No cache-control header was observed for this URL at all.
  if (transferSize > 0) {
    const issue = entry.isHashed || entry.isStatic ? 'no-cache' : null;
    return { cacheControl: 'no-cache (miss)', ttl: null, issue };
  }

  // transferSize === 0, decodedBodySize > 0: memory/disk cache hit, header unseen.
  if (entry.isHtml) {
    return {
      cacheControl: 'cached (⚠ HTML should revalidate)',
      ttl: null,
      issue: 'HTML served from cache (should revalidate)',
    };
  }
  if (entry.isHashed) {
    return { cacheControl: 'immutable (cached)', ttl: 31536000, issue: null };
  }
  return { cacheControl: 'cached', ttl: null, issue: null };
}

/** Extract cache and compression headers via CDP network domain. */
export async function extractCacheAudit(
  page: Page,
  headersByUrl?: Map<string, CacheHeaderInfo>,
): Promise<CacheAuditData> {
  const raw = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources.map((r) => {
      const name = r.name.split('/').pop()?.split('?')[0] || r.name;
      const isStatic = /\.(js|css|png|jpg|jpeg|webp|avif|gif|svg|woff2?|ttf|eot|ico)$/i.test(name);
      const isHashed =
        /[.-][a-f0-9]{6,}\.(js|css)/i.test(name) ||
        /\/_next\/static\//.test(r.name) ||
        /\/_astro\//.test(r.name);
      const isHtml = r.initiatorType === 'navigation' || /\.html?$/i.test(name);

      // Infer encoding from transfer ratio (headers don't carry this in a comparable way)
      let encoding = 'none';
      if (r.transferSize > 0 && r.decodedBodySize > 0) {
        const ratio = r.transferSize / r.decodedBodySize;
        if (ratio < 0.9) encoding = ratio < 0.4 ? 'br' : 'gzip';
      }

      return {
        name: name.length > 35 ? name.slice(0, 35) + '...' : name,
        url: r.name,
        type: r.initiatorType,
        transferSize: r.transferSize || 0,
        decodedBodySize: r.decodedBodySize || 0,
        encoding,
        isStatic,
        isHashed,
        isHtml,
      };
    });
  });

  const entries: CacheEntry[] = raw.map((r) => {
    const header = headersByUrl?.get(r.url)?.cacheControl;
    const { cacheControl, ttl, issue } = classifyCacheEntry(r, header);
    return {
      name: r.name,
      url: r.url,
      type: r.type,
      transferSize: r.transferSize,
      cacheControl,
      encoding: r.encoding,
      ttl,
      issue,
    };
  });

  // Build issues
  const issues: CacheAuditData['issues'] = [];
  const noCacheEntries = entries.filter((e) => e.issue === 'no-cache');
  if (noCacheEntries.length > 0) {
    issues.push({
      severity: 'high',
      message: `${noCacheEntries.length} static asset(s) not served from cache`,
    });
  }

  const shortTtlEntries = entries.filter((e) => e.issue?.includes('short-ttl'));
  if (shortTtlEntries.length > 0) {
    issues.push({
      severity: 'medium',
      message: `${shortTtlEntries.length} hashed asset(s) with a short cache TTL (<24h)`,
    });
  }

  const htmlCached = entries.filter((e) => e.issue?.includes('HTML'));
  if (htmlCached.length > 0) {
    issues.push({
      severity: 'medium',
      message: `${htmlCached.length} HTML page(s) served from cache (should revalidate for fresh content)`,
    });
  }

  const immutableCount = entries.filter((e) => e.cacheControl.includes('immutable')).length;

  return {
    entries,
    totalResources: entries.length,
    noCacheCount: noCacheEntries.length,
    shortTtlCount: shortTtlEntries.length,
    immutableCount,
    issues,
  };
}

export function formatCacheAudit(
  data: CacheAuditData,
  opts: { compact?: boolean; limit?: number } = {},
): string {
  const limit = opts.limit ?? 10;
  if (data.entries.length === 0) return '## Cache: No resources to audit\n';

  if (opts.compact) {
    const parts = [
      `${data.totalResources} resources`,
      `${data.immutableCount} immutable`,
      `${data.noCacheCount} issues`,
    ];
    const lines = [`## Cache: ${parts.join(' | ')}`];
    // Name the offenders per issue kind (largest first) — "35 no-cache" alone isn't actionable.
    const byIssue = new Map<string, CacheEntry[]>();
    for (const e of data.entries) {
      if (!e.issue) continue;
      if (!byIssue.has(e.issue)) byIssue.set(e.issue, []);
      byIssue.get(e.issue)!.push(e);
    }
    for (const [issue, entries] of byIssue) {
      const sorted = [...entries].sort((a, b) => b.transferSize - a.transferSize);
      lines.push(
        `- ${issue} (${entries.length}): ${sorted
          .slice(0, limit)
          .map((e) => e.name)
          .join(', ')}${sorted.length > limit ? ` … and ${sorted.length - limit} more` : ''}`,
      );
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## Cache Audit\n'];
  lines.push(
    `**${data.totalResources} resources** | ${data.immutableCount} immutable | ${data.noCacheCount} with issues\n`,
  );

  // Resources with issues first
  const withIssues = data.entries.filter((e) => e.issue !== null);
  if (withIssues.length > 0) {
    lines.push('### Issues\n');
    lines.push('| Resource | Type | Size | Cache Status | Issue |');
    lines.push('|----------|------|------|--------------|-------|');
    for (const e of withIssues.slice(0, 15)) {
      lines.push(
        `| ${e.name} | ${e.type} | ${formatBytes(e.transferSize)} | ${e.cacheControl} | ${e.issue} ⚠ |`,
      );
    }
    lines.push('');
  }

  // Summary issues
  if (data.issues.length > 0) {
    lines.push('### Recommendations\n');
    for (const issue of data.issues) {
      const icon = issue.severity === 'high' ? '✗' : issue.severity === 'medium' ? '⚠' : 'ℹ';
      lines.push(`- ${icon} **${issue.severity.toUpperCase()}:** ${issue.message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
