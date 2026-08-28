import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface CompressionEntry {
  name: string;
  type: string;
  encoding: string;
  transferSize: number;
  decodedSize: number;
  ratio: number;
}

export interface CompressionData {
  entries: CompressionEntry[];
  uncompressedCount: number;
  uncompressedSize: number;
  brotliCount: number;
  gzipCount: number;
  noneCount: number;
  potentialSavings: number;
}

/** Extract compression data for text resources via network entries. */
export async function extractCompression(page: Page): Promise<CompressionData> {
  const entries: CompressionEntry[] = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources
      .filter(r => {
        const name = r.name.split('/').pop()?.split('?')[0] || '';
        return /\.(js|css|html|json|xml|svg|txt|map)$/i.test(name) ||
          r.initiatorType === 'script' || r.initiatorType === 'link';
      })
      .filter(r => r.decodedBodySize > 1024) // Only check resources > 1KB
      .map(r => {
        const transferSize = r.transferSize || 0;
        const decodedSize = r.decodedBodySize || 0;
        // Infer encoding from size ratio
        let encoding = 'none';
        if (transferSize > 0 && decodedSize > 0) {
          const ratio = transferSize / decodedSize;
          if (ratio < 0.9) encoding = ratio < 0.4 ? 'br' : 'gzip';
        }
        return {
          name: r.name.split('/').pop()?.split('?')[0] || r.name,
          type: r.initiatorType,
          encoding,
          transferSize,
          decodedSize,
          ratio: decodedSize > 0 ? parseFloat((transferSize / decodedSize).toFixed(2)) : 1,
        };
      })
      .sort((a, b) => b.decodedSize - a.decodedSize);
  });

  const brotliCount = entries.filter(e => e.encoding === 'br').length;
  const gzipCount = entries.filter(e => e.encoding === 'gzip').length;
  const noneCount = entries.filter(e => e.encoding === 'none').length;
  const uncompressed = entries.filter(e => e.encoding === 'none');
  const uncompressedSize = uncompressed.reduce((s, e) => s + e.decodedSize, 0);
  // Estimate ~70% compression ratio for gzip
  const potentialSavings = uncompressed.reduce((s, e) => s + Math.round(e.decodedSize * 0.7), 0);

  return {
    entries,
    uncompressedCount: noneCount,
    uncompressedSize,
    brotliCount,
    gzipCount,
    noneCount,
    potentialSavings,
  };
}

export function formatCompression(data: CompressionData, opts: { compact?: boolean; limit?: number } = {}): string {
  if (data.entries.length === 0) return '## Compression: No text resources >1KB\n';
  const limit = opts.limit ?? 10;
  const uncompressed = data.entries.filter((e) => e.encoding === 'none');

  if (opts.compact) {
    const parts = [`${data.brotliCount} br`, `${data.gzipCount} gzip`, `${data.noneCount} none`];
    if (data.uncompressedCount > 0) {
      parts.push(`${formatBytes(data.potentialSavings)} potential savings ⚠`);
    }
    const lines = [`## Compression: ${parts.join(' | ')}`];
    // Name the uncompressed resources (largest first) — the count alone isn't actionable.
    if (uncompressed.length > 0) {
      const sorted = [...uncompressed].sort((a, b) => b.decodedSize - a.decodedSize);
      lines.push(`- uncompressed (${uncompressed.length}): ${sorted.slice(0, limit).map((e) => `${e.name} ${formatBytes(e.decodedSize)}`).join(', ')}${sorted.length > limit ? ` … and ${sorted.length - limit} more` : ''}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## Compression Check\n'];
  lines.push(`**Brotli:** ${data.brotliCount} | **Gzip:** ${data.gzipCount} | **None:** ${data.noneCount}\n`);

  if (data.uncompressedCount > 0) {
    lines.push(`**⚠ ${data.uncompressedCount} uncompressed resource(s)** (${formatBytes(data.uncompressedSize)} raw, ~${formatBytes(data.potentialSavings)} potential savings)\n`);
  }

  lines.push('| Resource | Type | Encoding | Raw Size | Transfer | Ratio |');
  lines.push('|----------|------|----------|----------|----------|-------|');
  for (const e of data.entries.slice(0, 15)) {
    const name = e.name.length > 30 ? e.name.slice(0, 30) + '...' : e.name;
    const flag = e.encoding === 'none' ? ' ⚠' : '';
    lines.push(`| ${name} | ${e.type} | ${e.encoding}${flag} | ${formatBytes(e.decodedSize)} | ${formatBytes(e.transferSize)} | ${(e.ratio * 100).toFixed(0)}% |`);
  }
  if (data.entries.length > 15) {
    lines.push(`| ... and ${data.entries.length - 15} more | | | | | |`);
  }

  lines.push('');
  return lines.join('\n');
}
