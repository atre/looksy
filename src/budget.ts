import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatBytes } from './utils.js';

export interface BudgetConfig {
  totalJS?: string; // e.g. "200KB"
  totalCSS?: string;
  totalImages?: string;
  totalTransfer?: string;
  FCP?: number; // ms
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
  sampleDetail?: string;
}

export interface BudgetData {
  results: BudgetCheckResult[];
  passCount: number;
  failCount: number;
  allPassed: boolean;
  sampleCount?: number;
}

/** min/median/max across sampled navigations for one metric, plus how many samples had it. */
export interface SampleStats {
  min: number;
  median: number;
  max: number;
  n: number;
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
  if (
    !trimmed.startsWith('{') &&
    trimmed.includes(':') &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  ) {
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
  totalJS?: number; // bytes
  totalCSS?: number; // bytes
  totalImages?: number; // bytes
  totalTransfer?: number; // bytes
  FCP?: number; // ms
  LCP?: number;
  CLS?: number;
  TTFB?: number;
  imageCount?: number;
  requestCount?: number;
}

// --budget-samples: these are the only actuals that vary run-to-run (they come from a
// fresh extractPerf() per navigation) and get median-aggregated across samples.
const SAMPLED_KEYS: (keyof BudgetActuals)[] = [
  'FCP',
  'LCP',
  'CLS',
  'TTFB',
  'requestCount',
  'totalTransfer',
];
// totalJS/totalCSS/totalImages/imageCount come from a single page's bundle/image analysis,
// not repeated per navigation — never sampled, just passed through.
const PASSTHROUGH_KEYS: (keyof BudgetActuals)[] = [
  'totalJS',
  'totalCSS',
  'totalImages',
  'imageCount',
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** CLS keeps 4 decimal places; every other sampled metric rounds to the nearest integer. */
function roundForKey(key: keyof BudgetActuals, value: number): number {
  return key === 'CLS' ? Math.round(value * 10000) / 10000 : Math.round(value);
}

/**
 * Aggregate BudgetActuals from N navigations of the same page (--budget-samples) into one
 * median-based BudgetActuals plus per-metric min/median/max/n stats.
 */
export function sampleBudgetActuals(samples: BudgetActuals[]): {
  actuals: BudgetActuals;
  stats: Partial<Record<keyof BudgetActuals, SampleStats>>;
} {
  const actuals: BudgetActuals = {};
  const stats: Partial<Record<keyof BudgetActuals, SampleStats>> = {};

  for (const key of SAMPLED_KEYS) {
    const values = samples.map((s) => s[key]).filter((v): v is number => v !== undefined);
    if (values.length === 0) continue;
    const min = roundForKey(key, Math.min(...values));
    const max = roundForKey(key, Math.max(...values));
    const med = roundForKey(key, median(values));
    actuals[key] = med;
    stats[key] = { min, median: med, max, n: values.length };
  }

  const last = samples[samples.length - 1];
  if (last) {
    for (const key of PASSTHROUGH_KEYS) {
      if (last[key] !== undefined) actuals[key] = last[key];
    }
  }

  return { actuals, stats };
}

/** Check actuals against budget limits. */
/** Format one sampled value using the same convention as that metric's actual/limit. */
function formatSampleValue(actualKey: keyof BudgetActuals, value: number): string {
  if (
    actualKey === 'totalJS' ||
    actualKey === 'totalCSS' ||
    actualKey === 'totalImages' ||
    actualKey === 'totalTransfer'
  ) {
    return formatBytes(value);
  }
  if (actualKey === 'FCP' || actualKey === 'LCP' || actualKey === 'TTFB') {
    return `${value}ms`;
  }
  return `${value}`; // CLS, requestCount, imageCount — bare number
}

function buildSampleDetail(
  actualKey: keyof BudgetActuals,
  sampleStats: Partial<Record<keyof BudgetActuals, SampleStats>> | undefined,
): string | undefined {
  const s = sampleStats?.[actualKey];
  if (!s) return undefined;
  const fmt = (v: number) => formatSampleValue(actualKey, v);
  return `min ${fmt(s.min)} / median ${fmt(s.median)} / max ${fmt(s.max)} (n=${s.n})`;
}

/** Check actuals against budget limits. `sampleStats` (from --budget-samples) annotates each
 *  row with a min/median/max sampleDetail when that row's metric was sampled. */
export function checkBudget(
  config: BudgetConfig,
  actuals: BudgetActuals,
  sampleStats?: Partial<Record<keyof BudgetActuals, SampleStats>>,
): BudgetData {
  const results: BudgetCheckResult[] = [];

  const sizeChecks: [keyof BudgetConfig, keyof BudgetActuals, string][] = [
    ['totalJS', 'totalJS', 'Total JS'],
    ['totalCSS', 'totalCSS', 'Total CSS'],
    ['totalImages', 'totalImages', 'Total Images'],
    ['totalTransfer', 'totalTransfer', 'Total Transfer'],
  ];

  // A budgeted metric that was never computed is a FAIL, not a 0-vs-limit pass —
  // comparing against a phantom 0 silently blessed pages whose analyzer never ran.
  const NOT_MEASURED = 'not measured — run with --speed/--bundles/--images';

  for (const [configKey, actualKey, label] of sizeChecks) {
    const limitStr = config[configKey];
    if (limitStr === undefined) continue;
    const limitBytes = parseSizeLimit(limitStr as string);
    const actualBytes = actuals[actualKey];
    if (actualBytes === undefined) {
      results.push({ metric: label, actual: NOT_MEASURED, limit: limitStr as string, passed: false });
      continue;
    }
    results.push({
      metric: label,
      actual: formatBytes(actualBytes as number),
      limit: limitStr as string,
      passed: (actualBytes as number) <= limitBytes,
      sampleDetail: buildSampleDetail(actualKey, sampleStats),
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
    const actual = actuals[actualKey];
    if (actual === undefined) {
      results.push({ metric: label, actual: NOT_MEASURED, limit: `${limit}${unit}`, passed: false });
      continue;
    }
    results.push({
      metric: label,
      actual: `${actual}${unit}`,
      limit: `${limit}${unit}`,
      passed: (actual as number) <= limit,
      sampleDetail: buildSampleDetail(actualKey, sampleStats),
    });
  }

  // CLS special case (lower is better, decimal)
  if (config.CLS !== undefined) {
    const actual = actuals.CLS;
    if (actual === undefined) {
      results.push({ metric: 'CLS', actual: NOT_MEASURED, limit: `${config.CLS}`, passed: false });
    } else {
      results.push({
        metric: 'CLS',
        actual: `${actual}`,
        limit: `${config.CLS}`,
        passed: actual <= config.CLS,
        sampleDetail: buildSampleDetail('CLS', sampleStats),
      });
    }
  }

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;

  const sampleCount = sampleStats
    ? Object.values(sampleStats).find((s): s is SampleStats => s !== undefined)?.n
    : undefined;

  return { results, passCount, failCount, allPassed: failCount === 0, sampleCount };
}

export function formatBudget(data: BudgetData, opts: { compact?: boolean } = {}): string {
  if (data.results.length === 0) return '## Budget: No budget checks configured\n';

  if (opts.compact) {
    const status = data.allPassed ? 'ALL PASSED ✓' : `${data.failCount} FAILED ✗`;
    const sampleNote = data.sampleCount ? ` (median of ${data.sampleCount})` : '';
    return `## Budget: ${data.passCount}/${data.results.length} passed — ${status}${sampleNote}\n`;
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

  const sampled = data.results.filter((r) => r.sampleDetail);
  if (sampled.length > 0) {
    lines.push('');
    lines.push('Samples:');
    for (const r of sampled) {
      lines.push(`- ${r.metric}: ${r.sampleDetail}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
