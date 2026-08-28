import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface LighthouseData {
  memoryUsed?: number;  // bytes
  memoryTotal?: number; // bytes
  resourceBreakdown: { type: string; count: number; size: number }[];
  longTasks: number;
  estimatedINP?: number; // ms
}

/**
 * Extended performance metrics: memory, resource breakdown, long tasks, INP estimation.
 * Lightweight alternative to full Lighthouse — no external dependency.
 */
export async function extractLighthouse(page: Page): Promise<LighthouseData> {
  return await page.evaluate(() => {
    const result: {
      memoryUsed?: number;
      memoryTotal?: number;
      resourceBreakdown: { type: string; count: number; size: number }[];
      longTasks: number;
      estimatedINP?: number;
    } = {
      resourceBreakdown: [],
      longTasks: 0,
    };

    // Memory (Chrome only)
    const perf = performance as any;
    if (perf.memory) {
      result.memoryUsed = perf.memory.usedJSHeapSize;
      result.memoryTotal = perf.memory.totalJSHeapSize;
    }

    // Resource breakdown by type
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const byType = new Map<string, { count: number; size: number }>();
    for (const r of resources) {
      const type = r.initiatorType || 'other';
      const entry = byType.get(type) || { count: 0, size: 0 };
      entry.count++;
      entry.size += r.transferSize || 0;
      byType.set(type, entry);
    }
    result.resourceBreakdown = Array.from(byType.entries())
      .map(([type, data]) => ({ type, ...data }))
      .sort((a, b) => b.size - a.size);

    // Long tasks (>50ms)
    const longTasks = performance.getEntriesByType('longtask') as any[];
    result.longTasks = longTasks.length;

    // INP estimation from event timing entries
    const eventEntries = performance.getEntriesByType('event') as any[];
    if (eventEntries.length > 0) {
      const durations = eventEntries.map((e: any) => e.duration).sort((a: number, b: number) => b - a);
      result.estimatedINP = durations[0]; // worst interaction
    }

    return result;
  });
}

export function formatLighthouse(data: LighthouseData, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    const parts: string[] = [];
    if (data.memoryUsed) parts.push(`JS heap=${formatBytes(data.memoryUsed)}`);
    parts.push(`${data.longTasks} long tasks`);
    if (data.estimatedINP) parts.push(`INP≈${data.estimatedINP}ms`);
    parts.push(`${data.resourceBreakdown.length} resource types`);
    return `## Lighthouse: ${parts.join(' | ')}\n`;
  }

  const lines = ['## Extended Performance\n'];

  if (data.memoryUsed) {
    lines.push(`- **JS Heap:** ${formatBytes(data.memoryUsed)} / ${formatBytes(data.memoryTotal ?? 0)}`);
  }
  lines.push(`- **Long Tasks (>50ms):** ${data.longTasks}`);
  if (data.estimatedINP) {
    const rating = data.estimatedINP <= 200 ? 'Good' : data.estimatedINP <= 500 ? 'Needs Work' : 'Poor';
    lines.push(`- **Estimated INP:** ${data.estimatedINP}ms (${rating})`);
  }

  if (data.resourceBreakdown.length > 0) {
    lines.push('');
    lines.push('### Resource Breakdown\n');
    lines.push('| Type | Count | Size |');
    lines.push('|------|-------|------|');
    for (const r of data.resourceBreakdown) {
      lines.push(`| ${r.type} | ${r.count} | ${formatBytes(r.size)} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
