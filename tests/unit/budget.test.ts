import { describe, it, expect } from 'vitest';
import {
  parseSizeLimit,
  loadBudgetConfig,
  checkBudget,
  formatBudget,
  sampleBudgetActuals,
  type BudgetConfig,
  type BudgetActuals,
} from '../../src/budget.js';

describe('parseSizeLimit', () => {
  it('parses KB', () => {
    expect(parseSizeLimit('200KB')).toBe(200 * 1024);
  });

  it('parses MB', () => {
    expect(parseSizeLimit('1.5MB')).toBe(1.5 * 1048576);
  });

  it('parses B', () => {
    expect(parseSizeLimit('500B')).toBe(500);
  });
});

describe('loadBudgetConfig', () => {
  it('parses inline string', () => {
    const config = loadBudgetConfig('totalJS:200KB,FCP:1800');
    expect(config.totalJS).toBe('200KB');
    expect(config.FCP).toBe(1800);
  });
});

describe('checkBudget', () => {
  it('passes when within budget', () => {
    const config: BudgetConfig = { totalJS: '200KB', FCP: 2000 };
    const actuals: BudgetActuals = { totalJS: 100 * 1024, FCP: 1500 };
    const result = checkBudget(config, actuals);
    expect(result.allPassed).toBe(true);
    expect(result.failCount).toBe(0);
  });

  it('fails when over budget', () => {
    const config: BudgetConfig = { totalJS: '100KB', FCP: 1000 };
    const actuals: BudgetActuals = { totalJS: 200 * 1024, FCP: 2000 };
    const result = checkBudget(config, actuals);
    expect(result.allPassed).toBe(false);
    expect(result.failCount).toBe(2);
  });
});

describe('formatBudget', () => {
  it('compact mode shows pass/fail', () => {
    const data = checkBudget({ totalJS: '200KB', FCP: 2000 }, { totalJS: 100 * 1024, FCP: 1500 });
    const result = formatBudget(data, { compact: true });
    expect(result).toContain('ALL PASSED');
    expect(result).toContain('2/2');
  });

  it('verbose mode shows table', () => {
    const data = checkBudget({ totalJS: '100KB', FCP: 1000 }, { totalJS: 200 * 1024, FCP: 2000 });
    const result = formatBudget(data);
    expect(result).toContain('Performance Budget');
    expect(result).toContain('FAIL');
    expect(result).toContain('Total JS');
    expect(result).toContain('FCP');
  });

  it('shows empty when no checks configured', () => {
    const data = checkBudget({}, {});
    const result = formatBudget(data);
    expect(result).toContain('No budget checks');
  });
});

describe('sampleBudgetActuals', () => {
  it('medians an odd sample count (middle value)', () => {
    const samples: BudgetActuals[] = [{ FCP: 300 }, { FCP: 100 }, { FCP: 200 }];
    const { actuals, stats } = sampleBudgetActuals(samples);
    expect(actuals.FCP).toBe(200);
    expect(stats.FCP).toEqual({ min: 100, median: 200, max: 300, n: 3 });
  });

  it('medians an even sample count (average of the two middle values)', () => {
    const samples: BudgetActuals[] = [{ FCP: 100 }, { FCP: 400 }, { FCP: 200 }, { FCP: 300 }];
    const { actuals, stats } = sampleBudgetActuals(samples);
    expect(actuals.FCP).toBe(250);
    expect(stats.FCP).toEqual({ min: 100, median: 250, max: 400, n: 4 });
  });

  it('rounds CLS to 4 decimal places (min/median/max alike)', () => {
    const samples: BudgetActuals[] = [{ CLS: 0.05001 }, { CLS: 0.10002 }, { CLS: 0.02003 }];
    const { actuals, stats } = sampleBudgetActuals(samples);
    expect(actuals.CLS).toBe(0.05);
    expect(stats.CLS).toEqual({ min: 0.02, median: 0.05, max: 0.1, n: 3 });
  });

  it('passes totalJS/totalImages/imageCount through unchanged from the last sample', () => {
    const samples: BudgetActuals[] = [
      { FCP: 1000, totalJS: 100 * 1024, totalImages: 50 * 1024, imageCount: 5 },
      { FCP: 2000, totalJS: 200 * 1024, totalImages: 60 * 1024, imageCount: 6 },
    ];
    const { actuals, stats } = sampleBudgetActuals(samples);
    expect(actuals.totalJS).toBe(200 * 1024);
    expect(actuals.totalImages).toBe(60 * 1024);
    expect(actuals.imageCount).toBe(6);
    // Pass-through keys are never sampled/aggregated — no stats entry for them.
    expect(stats.totalJS).toBeUndefined();
    expect(stats.imageCount).toBeUndefined();
  });

  it('only reads pass-through keys from the last sample, not earlier ones', () => {
    const samples: BudgetActuals[] = [{ FCP: 1000, totalJS: 100 * 1024 }, { FCP: 2000 }];
    const { actuals } = sampleBudgetActuals(samples);
    expect(actuals.totalJS).toBeUndefined();
  });

  it('skips a key entirely absent across all samples instead of zero-filling it', () => {
    const samples: BudgetActuals[] = [{ FCP: 1000 }, { FCP: 2000 }];
    const { actuals, stats } = sampleBudgetActuals(samples);
    expect(actuals.LCP).toBeUndefined();
    expect(stats.LCP).toBeUndefined();
    expect('LCP' in actuals).toBe(false);
  });
});

describe('checkBudget with sampleStats', () => {
  const config: BudgetConfig = { totalJS: '300KB', FCP: 2000, CLS: 0.2, requestCount: 20 };
  const actuals: BudgetActuals = { totalJS: 150 * 1024, FCP: 1500, CLS: 0.05, requestCount: 12 };
  const sampleStats = {
    totalJS: { min: 100 * 1024, median: 150 * 1024, max: 200 * 1024, n: 3 },
    FCP: { min: 1000, median: 1500, max: 2000, n: 3 },
    CLS: { min: 0.02, median: 0.05, max: 0.1, n: 3 },
    requestCount: { min: 10, median: 12, max: 15, n: 3 },
  };

  it('formats sampleDetail per metric type (bytes / ms / bare CLS / bare int)', () => {
    const data = checkBudget(config, actuals, sampleStats);
    const byMetric = Object.fromEntries(data.results.map((r) => [r.metric, r]));
    expect(byMetric['Total JS'].sampleDetail).toBe(
      'min 100.0 KB / median 150.0 KB / max 200.0 KB (n=3)',
    );
    expect(byMetric['FCP'].sampleDetail).toBe('min 1000ms / median 1500ms / max 2000ms (n=3)');
    expect(byMetric['CLS'].sampleDetail).toBe('min 0.02 / median 0.05 / max 0.1 (n=3)');
    expect(byMetric['Request Count'].sampleDetail).toBe('min 10 / median 12 / max 15 (n=3)');
  });

  it('sets data.sampleCount from the sampled n', () => {
    const data = checkBudget(config, actuals, sampleStats);
    expect(data.sampleCount).toBe(3);
  });

  it('leaves sampleDetail/sampleCount unset when sampleStats is omitted', () => {
    const data = checkBudget(config, actuals);
    expect(data.sampleCount).toBeUndefined();
    expect(data.results.every((r) => r.sampleDetail === undefined)).toBe(true);
  });
});

describe('formatBudget with sampling', () => {
  const config: BudgetConfig = { FCP: 2000 };
  const actuals: BudgetActuals = { FCP: 1500 };
  const sampleStats = { FCP: { min: 1000, median: 1500, max: 2000, n: 3 } };

  it('compact mode appends "(median of N)" only when sampled', () => {
    const sampled = formatBudget(checkBudget(config, actuals, sampleStats), { compact: true });
    expect(sampled).toContain('(median of 3)');

    const unsampled = formatBudget(checkBudget(config, actuals), { compact: true });
    expect(unsampled).not.toContain('median of');
  });

  it('non-compact mode adds a Samples: section listing per-metric detail lines', () => {
    const result = formatBudget(checkBudget(config, actuals, sampleStats));
    expect(result).toContain('Samples:');
    expect(result).toContain('- FCP: min 1000ms / median 1500ms / max 2000ms (n=3)');
  });

  it('non-compact mode omits the Samples: section when not sampled', () => {
    const result = formatBudget(checkBudget(config, actuals));
    expect(result).not.toContain('Samples:');
  });
});

describe('unmeasured budgeted metrics fail instead of passing against a phantom 0', () => {
  it('size keys (totalJS/totalCSS) with no actual → FAIL row marked "not measured"', () => {
    const data = checkBudget({ totalJS: '200KB', totalCSS: '100KB' }, {});
    expect(data.allPassed).toBe(false);
    expect(data.failCount).toBe(2);
    for (const r of data.results) {
      expect(r.passed).toBe(false);
      expect(r.actual).toContain('not measured');
    }
  });

  it('numeric keys (FCP/imageCount) with no actual → FAIL, measured keys unaffected', () => {
    const data = checkBudget({ FCP: 1800, imageCount: 20 }, { FCP: 900 });
    expect(data.results.find((r) => r.metric === 'FCP')?.passed).toBe(true);
    const ic = data.results.find((r) => r.metric === 'Image Count');
    expect(ic?.passed).toBe(false);
    expect(ic?.actual).toContain('not measured');
  });

  it('CLS undefined → FAIL "not measured"; CLS 0 still passes', () => {
    expect(checkBudget({ CLS: 0.1 }, {}).allPassed).toBe(false);
    expect(checkBudget({ CLS: 0.1 }, { CLS: 0 }).allPassed).toBe(true);
  });

  it('the not-measured row names the analyzer flags in the formatted table', () => {
    const text = formatBudget(checkBudget({ totalJS: '200KB' }, {}));
    expect(text).toContain('not measured — run with --speed/--bundles/--images');
    expect(text).toContain('✗ FAIL');
  });
});
