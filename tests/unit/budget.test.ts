import { describe, it, expect } from 'vitest';
import { parseSizeLimit, loadBudgetConfig, checkBudget, formatBudget, type BudgetConfig, type BudgetActuals } from '../../src/budget.js';

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
