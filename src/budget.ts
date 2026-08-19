import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatBytes } from './utils.js';

export interface BudgetConfig {
  totalJS?: string;    // e.g. "200KB"
  totalCSS?: string;
  totalImages?: string;
  totalTransfer?: string;
  FCP?: number;        // ms
  LCP?: number;
  CLS?: number;
  TTFB?: number;
  imageCount?: number;
  requestCount?: number;
}

export interface BudgetCheckResult {
  metric: string;
  actual: string;
  limit: string;
  passed: boolean;
}

export interface BudgetData {
  results: BudgetCheckResult[];
  passCount: number;
  failCount: number;
  allPassed: boolean;
}

/** Parse a size string like "200KB" or "1.5MB" into bytes. */
export function parseSizeLimit(value: string): number {
  const match = value.trim().match(/^([\d.]+)\s*(KB|MB|B)$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'MB') return num * 1048576;
  if (unit === 'KB') return num * 1024;
  return num;
}

/** Load budget config from JSON file or inline string. */
export function loadBudgetConfig(input: string): BudgetConfig {
  const trimmed = input.trim();

  // Inline pair grammar: "totalJS:200KB,FCP:1800"
  // Distinguishable from a path because paths don't have ":" unless Windows-drive,
  // and distinguishable from JSON because JSON starts with "{".
  if (!trimmed.startsWith('{') && trimmed.includes(':') && !trimmed.includes('/') && !trimmed.includes('\\')) {
    const config: Record<string, any> = {};
    for (const pair of trimmed.split(',')) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx < 0) continue;
      const key = pair.slice(0, colonIdx).trim();
      const val = pair.slice(colonIdx + 1).trim();
      if (!key || !val) continue;
      // Numeric values for timing metrics
      if (/^\d+(\.\d+)?$/.test(val)) {
        config[key] = parseFloat(val);
      } else {
        config[key] = val;
      }
    }
    return config as BudgetConfig;
  }

  // Raw JSON string
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (err: any) {
      throw new Error(`Invalid budget JSON: ${err.message}`);
    }
  }

  // File path — validate it stays within cwd
  const resolved = resolve(input);
  const cwd = process.cwd();
  if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
    throw new Error(`Budget file must be within current directory: ${input}`);
  }

  let content: string;
  try {
    content = readFileSync(resolved, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Budget file not found: ${input}`);
    }
    throw new Error(`Cannot read budget file "${input}": ${err.message}`);
  }

  try {
    return JSON.parse(content);
  } catch (err: any) {
    throw new Error(`Invalid JSON in budget file "${input}": ${err.message}`);
  }
}

export interface BudgetActuals {
  totalJS?: number;       // bytes
  totalCSS?: number;      // bytes
  totalImages?: number;   // bytes
  totalTransfer?: number; // bytes
  FCP?: number;           // ms
  LCP?: number;
  CLS?: number;
  TTFB?: number;
  imageCount?: number;
  requestCount?: number;
}

/** Check actuals against budget limits. */
export function checkBudget(config: BudgetConfig, actuals: BudgetActuals): BudgetData {
  const results: BudgetCheckResult[] = [];

  const sizeChecks: [keyof BudgetConfig, keyof BudgetActuals, string][] = [
    ['totalJS', 'totalJS', 'Total JS'],
    ['totalCSS', 'totalCSS', 'Total CSS'],
    ['totalImages', 'totalImages', 'Total Images'],
    ['totalTransfer', 'totalTransfer', 'Total Transfer'],
  ];

  for (const [configKey, actualKey, label] of sizeChecks) {
    const limitStr = config[configKey];
    if (limitStr === undefined) continue;
    const limitBytes = parseSizeLimit(limitStr as string);
    const actualBytes = actuals[actualKey] ?? 0;
    results.push({
      metric: label,
      actual: formatBytes(actualBytes as number),
      limit: limitStr as string,
      passed: (actualBytes as number) <= limitBytes,
    });
  }

  const numericChecks: [keyof BudgetConfig, keyof BudgetActuals, string, string][] = [
    ['FCP', 'FCP', 'FCP', 'ms'],
    ['LCP', 'LCP', 'LCP', 'ms'],
    ['TTFB', 'TTFB', 'TTFB', 'ms'],
    ['imageCount', 'imageCount', 'Image Count', ''],
    ['requestCount', 'requestCount', 'Request Count', ''],
  ];

  for (const [configKey, actualKey, label, unit] of numericChecks) {
    const limit = config[configKey] as number | undefined;
    if (limit === undefined) continue;
    const actual = actuals[actualKey] ?? 0;
    results.push({
      metric: label,
      actual: `${actual}${unit}`,
      limit: `${limit}${unit}`,
      passed: (actual as number) <= limit,
    });
  }

  // CLS special case (lower is better, decimal)
  if (config.CLS !== undefined) {
    const actual = actuals.CLS ?? 0;
    results.push({
      metric: 'CLS',
      actual: `${actual}`,
      limit: `${config.CLS}`,
      passed: actual <= config.CLS,
    });
  }

  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;

  return { results, passCount, failCount, allPassed: failCount === 0 };
}

export function formatBudget(data: BudgetData, opts: { compact?: boolean } = {}): string {
  if (data.results.length === 0) return '## Budget: No budget checks configured\n';

  if (opts.compact) {
    const status = data.allPassed ? 'ALL PASSED ✓' : `${data.failCount} FAILED ✗`;
    return `## Budget: ${data.passCount}/${data.results.length} passed — ${status}\n`;
  }

  const lines = ['## Performance Budget\n'];
  const status = data.allPassed ? '✓ All budgets passed' : `✗ ${data.failCount} budget(s) exceeded`;
  lines.push(`**${status}** (${data.passCount}/${data.results.length})\n`);

  lines.push('| Metric | Actual | Limit | Status |');
  lines.push('|--------|--------|-------|--------|');
  for (const r of data.results) {
    const status = r.passed ? '✓ Pass' : '✗ FAIL';
    lines.push(`| ${r.metric} | ${r.actual} | ${r.limit} | ${status} |`);
  }

  lines.push('');
  return lines.join('\n');
}
