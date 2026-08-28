import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface NetworkResource {
  name: string;
  type: string;
  duration: number;
  transferSize: number;
  startTime: number;
  decodedSize: number;
}

export interface NetworkData {
  resources: NetworkResource[];
  totalSize: number;
  totalDuration: number;
  slowCount: number;
}

/** Extract raw network resource data from the page. */
export async function extractNetworkData(page: Page): Promise<NetworkData> {
  const resources: NetworkResource[] = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return entries
      .map((e) => ({
        name: e.name.split('/').pop()?.split('?')[0] || e.name,
        type: e.initiatorType,
        duration: Math.round(e.duration),
        transferSize: e.transferSize || 0,
        startTime: Math.round(e.startTime),
        decodedSize: e.decodedBodySize || 0,
      }))
      .sort((a, b) => b.duration - a.duration);
  });

  const totalSize = resources.reduce((sum, r) => sum + r.transferSize, 0);
  const totalDuration = resources.length > 0 ? Math.max(...resources.map((r) => r.startTime + r.duration)) : 0;
  const slowCount = resources.filter((r) => r.duration > 500).length;

  return { resources, totalSize, totalDuration, slowCount };
}

/** Format network data as markdown. */
export function formatNetwork(data: NetworkData, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? false;
  const { resources, totalSize, totalDuration, slowCount } = data;

  if (resources.length === 0) {
    return '## Network: No resources loaded\n';
  }

  const slow = resources.filter((r) => r.duration > 500);

  if (compact) {
    if (slow.length === 0) {
      return `## Network: ${resources.length} resources, ${formatBytes(totalSize)}, ${totalDuration}ms — no slow resources\n`;
    }
    const lines: string[] = [`## Network: ${resources.length} resources, ${formatBytes(totalSize)}, ${totalDuration}ms — ${slow.length} slow`];
    for (const r of slow.slice(0, 5)) {
      lines.push(`- ${r.name} (${r.type}): ${r.duration}ms, ${formatBytes(r.transferSize)}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines: string[] = ['## Network Waterfall\n'];
  lines.push(`**${resources.length} resources** | ${formatBytes(totalSize)} transferred | ${totalDuration}ms total\n`);
  lines.push('| Resource | Type | Size | Duration | Start |');
  lines.push('|----------|------|------|----------|-------|');

  for (const r of resources.slice(0, 15)) {
    const name = r.name.length > 30 ? r.name.slice(0, 30) + '...' : r.name;
    lines.push(
      `| ${name} | ${r.type} | ${formatBytes(r.transferSize)} | ${r.duration}ms | ${r.startTime}ms |`,
    );
  }

  if (resources.length > 15) {
    lines.push(`| ... and ${resources.length - 15} more | | | | |`);
  }

  if (slow.length > 0) {
    lines.push('');
    lines.push(`**${slow.length} slow resource(s)** (>500ms):`);
    for (const r of slow.slice(0, 5)) {
      lines.push(`- ${r.name} (${r.type}): ${r.duration}ms`);
    }
  }

  lines.push('');
  return lines.join('\n');
}


