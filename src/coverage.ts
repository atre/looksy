import { formatBytes } from './utils.js';

export interface CoverageEntry {
  url: string;
  type: 'js' | 'css';
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface CoverageData {
  entries: CoverageEntry[];
  totalBytes: number;
  usedBytes: number;
  overallPercent: number;
}

/**
 * Extract CSS and JS coverage data from a CDP session.
 * Must be called after startPreciseCoverage + CSS.startRuleUsageTracking.
 */
export async function extractCoverage(cdp: any): Promise<CoverageData> {
  const entries: CoverageEntry[] = [];

  // JS coverage
  try {
    const { result } = await cdp.send('Profiler.takePreciseCoverage');
    for (const script of result) {
      if (!script.url || script.url.startsWith('data:')) continue;
      let totalBytes = 0;
      let usedBytes = 0;
      for (const func of script.functions) {
        for (const range of func.ranges) {
          const size = range.endOffset - range.startOffset;
          totalBytes += size;
          if (range.count > 0) usedBytes += size;
        }
      }
      if (totalBytes > 0) {
        entries.push({
          url: script.url.split('/').pop()?.split('?')[0] || script.url,
          type: 'js',
          totalBytes,
          usedBytes,
          usedPercent: Math.round((usedBytes / totalBytes) * 100),
        });
      }
    }
    await cdp.send('Profiler.stopPreciseCoverage');
  } catch { /* JS coverage not available */ }

  // CSS coverage
  try {
    const { ruleUsage } = await cdp.send('CSS.stopRuleUsageTracking');
    const cssMap = new Map<string, { total: number; used: number }>();
    for (const rule of ruleUsage) {
      const key = rule.styleSheetId || 'inline';
      const entry = cssMap.get(key) || { total: 0, used: 0 };
      const size = rule.endOffset - rule.startOffset;
      entry.total += size;
      if (rule.used) entry.used += size;
      cssMap.set(key, entry);
    }
    for (const [key, data] of cssMap) {
      if (data.total > 0) {
        entries.push({
          url: key.length > 30 ? key.slice(0, 30) : key,
          type: 'css',
          totalBytes: data.total,
          usedBytes: data.used,
          usedPercent: Math.round((data.used / data.total) * 100),
        });
      }
    }
  } catch { /* CSS coverage not available */ }

  // Sort by unused bytes (most waste first)
  entries.sort((a, b) => (b.totalBytes - b.usedBytes) - (a.totalBytes - a.usedBytes));

  const totalBytes = entries.reduce((sum, e) => sum + e.totalBytes, 0);
  const usedBytes = entries.reduce((sum, e) => sum + e.usedBytes, 0);

  return {
    entries: entries.slice(0, 20),
    totalBytes,
    usedBytes,
    overallPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 100,
  };
}

export function formatCoverage(data: CoverageData, opts: { compact?: boolean } = {}): string {
  if (data.entries.length === 0) return '## Coverage: no data\n';

  if (opts.compact) {
    const unused = data.totalBytes - data.usedBytes;
    return `## Coverage: ${data.overallPercent}% used, ${formatBytes(unused)} unused across ${data.entries.length} files\n`;
  }

  const lines = ['## Code Coverage\n'];
  lines.push(`**Overall:** ${data.overallPercent}% used (${formatBytes(data.usedBytes)} / ${formatBytes(data.totalBytes)})\n`);
  lines.push('| File | Type | Total | Used | % |');
  lines.push('|------|------|-------|------|---|');
  for (const e of data.entries) {
    lines.push(`| ${e.url} | ${e.type} | ${formatBytes(e.totalBytes)} | ${formatBytes(e.usedBytes)} | ${e.usedPercent}% |`);
  }
  lines.push('');
  return lines.join('\n');
}
