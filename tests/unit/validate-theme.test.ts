import { describe, it, expect } from 'vitest';
import { parseColor, validateTheme, formatThemeResults } from '../../dist/validate-theme.js';

describe('parseColor', () => {
  it('parses #rrggbb', () => {
    expect(parseColor('#ffffff')).toEqual([255, 255, 255]);
    expect(parseColor('#000000')).toEqual([0, 0, 0]);
    expect(parseColor('#1a1a2e')).toEqual([26, 26, 46]);
  });

  it('parses #rgb shorthand', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#000')).toEqual([0, 0, 0]);
    expect(parseColor('#f00')).toEqual([255, 0, 0]);
  });

  it('parses rgb()', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual([255, 255, 255]);
    expect(parseColor('rgba(0, 0, 0, 1)')).toEqual([0, 0, 0]);
  });

  it('returns null for invalid', () => {
    expect(parseColor('red')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('validateTheme', () => {
  it('white on black passes AA and AAA', () => {
    const results = validateTheme([{ fg: '#ffffff', bg: '#000000', label: 'White on Black' }]);
    expect(results).toHaveLength(1);
    expect(results[0].ratio).toBeCloseTo(21, 0);
    expect(results[0].aaPass).toBe(true);
    expect(results[0].aaaPass).toBe(true);
  });

  it('identical colors fail both', () => {
    const results = validateTheme([{ fg: '#333333', bg: '#333333', label: 'Same color' }]);
    expect(results[0].ratio).toBeCloseTo(1, 0);
    expect(results[0].aaPass).toBe(false);
    expect(results[0].aaaPass).toBe(false);
  });

  it('borderline AA case', () => {
    // #767676 on white = ~4.54:1 (just passes AA)
    const results = validateTheme([{ fg: '#767676', bg: '#ffffff', label: 'Gray on white' }]);
    expect(results[0].aaPass).toBe(true);
    expect(results[0].aaaPass).toBe(false);
  });
});

describe('formatThemeResults', () => {
  const results = [
    { label: 'Good', fg: '#000', bg: '#fff', ratio: 21, aaPass: true, aaaPass: true },
    { label: 'Bad', fg: '#ccc', bg: '#fff', ratio: 1.6, aaPass: false, aaaPass: false },
  ];

  it('compact mode shows failure count', () => {
    const out = formatThemeResults(results, { compact: true });
    expect(out).toContain('1/2 fail AA');
    expect(out).toContain('Bad');
  });

  it('verbose mode shows table', () => {
    const out = formatThemeResults(results);
    expect(out).toContain('## Theme Validation');
    expect(out).toContain('| Good |');
    expect(out).toContain('**FAIL**');
    expect(out).toContain('AA Failures (1)');
  });

  it('all-pass shows success message', () => {
    const passing = [results[0]];
    const out = formatThemeResults(passing);
    expect(out).toContain('All 1 pairs pass WCAG AA');
  });
});
