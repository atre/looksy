import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface BundleEntry {
  name: string;
  url: string;
  transferSize: number;
  decodedSize: number;
  duration: number;
  category: 'framework' | 'page' | 'shared' | 'vendor' | 'other';
}

export interface BundleData {
  entries: BundleEntry[];
  totalTransferSize: number;
  totalDecodedSize: number;
  largeChunks: BundleEntry[];
  categoryBreakdown: { category: string; count: number; transferSize: number }[];
}

/** Categorize a JS resource URL (Next.js naming conventions). */
function categorizeChunk(name: string, url: string): BundleEntry['category'] {
  if (/framework|react|next/.test(name)) return 'framework';
  if (/node_modules|vendor|polyfill/.test(url)) return 'vendor';
  if (/webpack|_buildManifest|_ssgManifest|chunks\/commons/.test(name)) return 'shared';
  if (/pages\/|app\//.test(url)) return 'page';
  if (/chunks\//.test(url) || /\.[a-f0-9]{6,}\.js$/.test(name)) return 'shared';
  return 'other';
}

/** Extract JS bundle data from the page via Performance API. */
export async function extractBundles(page: Page): Promise<BundleData> {
  const raw = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return entries
      .filter(e => e.initiatorType === 'script' || (e.name.endsWith('.js') && e.initiatorType === 'link'))
      .map(e => ({
        name: e.name.split('/').pop()?.split('?')[0] || e.name,
        url: e.name,
        transferSize: e.transferSize || 0,
        decodedSize: e.decodedBodySize || 0,
        duration: Math.round(e.duration),
      }));
  });

  const entries: BundleEntry[] = raw.map(r => ({
    ...r,
    category: categorizeChunk(r.name, r.url),
  }));

  entries.sort((a, b) => b.transferSize - a.transferSize);

  const totalTransferSize = entries.reduce((s, e) => s + e.transferSize, 0);
  const totalDecodedSize = entries.reduce((s, e) => s + e.decodedSize, 0);
  const largeChunks = entries.filter(e => e.transferSize > 50 * 1024);

  // Category breakdown
  const catMap = new Map<string, { count: number; transferSize: number }>();
  for (const e of entries) {
    const c = catMap.get(e.category) || { count: 0, transferSize: 0 };
    c.count++;
    c.transferSize += e.transferSize;
    catMap.set(e.category, c);
  }
  const categoryBreakdown = Array.from(catMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.transferSize - a.transferSize);

  return { entries, totalTransferSize, totalDecodedSize, largeChunks, categoryBreakdown };
}

export function formatBundles(data: BundleData, opts: { compact?: boolean; limit?: number } = {}): string {
  const limit = opts.limit ?? 10;
  if (data.entries.length === 0) return '## Bundles: No JS bundles loaded\n';

  if (opts.compact) {
    const parts = [
      `${data.entries.length} JS bundles`,
      `${formatBytes(data.totalTransferSize)} gzip`,
      `${formatBytes(data.totalDecodedSize)} raw`,
    ];
    if (data.largeChunks.length > 0) parts.push(`${data.largeChunks.length} large (>50KB)`);
    const lines = [`## Bundles: ${parts.join(' | ')}`];
    if (data.largeChunks.length > 0) {
      const sorted = [...data.largeChunks].sort((a, b) => b.transferSize - a.transferSize);
      lines.push(`- large: ${sorted.slice(0, limit).map((c) => `${c.name} ${formatBytes(c.transferSize)}`).join(', ')}${sorted.length > limit ? ` … and ${sorted.length - limit} more` : ''}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## JS Bundle Analysis\n'];
  lines.push(`**${data.entries.length} bundles** | ${formatBytes(data.totalTransferSize)} gzip | ${formatBytes(data.totalDecodedSize)} raw\n`);

  // Category breakdown
  if (data.categoryBreakdown.length > 0) {
    lines.push('### By Category\n');
    lines.push('| Category | Count | Transfer Size |');
    lines.push('|----------|-------|---------------|');
    for (const c of data.categoryBreakdown) {
      lines.push(`| ${c.category} | ${c.count} | ${formatBytes(c.transferSize)} |`);
    }
    lines.push('');
  }

  // All bundles
  lines.push('### All Bundles\n');
  lines.push('| Bundle | Category | Gzip | Raw | Load Time |');
  lines.push('|--------|----------|------|-----|-----------|');
  for (const e of data.entries.slice(0, 20)) {
    const name = e.name.length > 35 ? e.name.slice(0, 35) + '...' : e.name;
    const flag = e.transferSize > 50 * 1024 ? ' ⚠' : '';
    lines.push(`| ${name} | ${e.category} | ${formatBytes(e.transferSize)}${flag} | ${formatBytes(e.decodedSize)} | ${e.duration}ms |`);
  }
  if (data.entries.length > 20) {
    lines.push(`| ... and ${data.entries.length - 20} more | | | | |`);
  }

  // Large chunks warning
  if (data.largeChunks.length > 0) {
    lines.push('');
    lines.push(`**${data.largeChunks.length} large chunk(s)** (>50KB gzip):`);
    for (const c of data.largeChunks) {
      lines.push(`- ${c.name} (${c.category}): ${formatBytes(c.transferSize)} gzip`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
