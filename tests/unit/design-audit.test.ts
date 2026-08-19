import { describe, it, expect } from 'vitest';
import { applyCompoundFlags } from '../../dist/cli.js';

// Test that --design-audit expands to the correct set of flags, via the real
// expander cli.ts uses (applyCompoundFlags), not a hand-maintained mirror.

type ValuesMap = Record<string, boolean | string | undefined>;

function applyDesignAudit(values: ValuesMap): ValuesMap {
  const result = { ...values };
  applyCompoundFlags(result);
  return result;
}

describe('--design-audit compound flag expansion', () => {
  it('sets all required flags when design-audit is true', () => {
    const values: ValuesMap = { 'design-audit': true };
    const expanded = applyDesignAudit(values);

    expect(expanded.full).toBe(true);
    expect(expanded.compact).toBe(true);
    expect(expanded.meta).toBe(true);
    expect(expanded['css-vars']).toBe(true);
    expect(expanded.contrast).toBe(true);
    expect(expanded.seo).toBe(true);
    expect(expanded.schema).toBe(true);
    expect(expanded.fonts).toBe(true);
    expect(expanded['font-sources']).toBe(true);
    expect(expanded.suggest).toBe(true);
  });

  it('is a superset of --design (every flag --design sets is also set)', () => {
    const expanded = applyDesignAudit({ 'design-audit': true });
    expect(expanded.meta).toBe(true);
    expect(expanded['css-vars']).toBe(true);
    expect(expanded.fonts).toBe(true);
    expect(expanded.full).toBe(true);
    expect(expanded.compact).toBe(true);
    expect(expanded.contrast).toBe(true);
    expect(expanded.suggest).toBe(true);
  });

  it('folds in responsive-check for mobile + touch-target coverage', () => {
    const values: ValuesMap = { 'design-audit': true };
    const expanded = applyDesignAudit(values);
    // contrast + responsive-check together → per-breakpoint contrast at 375/768/1440
    expect(expanded['responsive-check']).toBe(true);
    expect(expanded.contrast).toBe(true);
  });

  it('sets correct --check assertions', () => {
    const values: ValuesMap = { 'design-audit': true };
    const expanded = applyDesignAudit(values);

    expect(expanded.check).toBe('no generator, self-hosted-fonts, contrast:aa');
  });

  it('includes no-google-fonts is NOT in default check (only self-hosted-fonts)', () => {
    // --design-audit uses self-hosted-fonts (broader check), not no-google-fonts
    const values: ValuesMap = { 'design-audit': true };
    const expanded = applyDesignAudit(values);
    expect(expanded.check).toContain('self-hosted-fonts');
    expect(expanded.check).not.toContain('no-google-fonts');
  });

  it('merges with existing --check value', () => {
    const values: ValuesMap = { 'design-audit': true, check: 'sticky header' };
    const expanded = applyDesignAudit(values);

    expect(expanded.check).toContain('sticky header');
    expect(expanded.check).toContain('no generator');
    expect(expanded.check).toContain('self-hosted-fonts');
    expect(expanded.check).toContain('contrast:aa');
  });

  it('does not apply when design-audit is false', () => {
    const values: ValuesMap = { 'design-audit': false };
    const expanded = applyDesignAudit(values);

    expect(expanded.full).toBeUndefined();
    expect(expanded.contrast).toBeUndefined();
    expect(expanded.check).toBeUndefined();
  });

  it('does not override existing false flags (design-audit forces them true)', () => {
    // Existing false flags should be overridden by design-audit expansion
    const values: ValuesMap = { 'design-audit': true, full: false, compact: false };
    const expanded = applyDesignAudit(values);

    // design-audit forces these true
    expect(expanded.full).toBe(true);
    expect(expanded.compact).toBe(true);
  });

  it('contains contrast:aa check assertion (WCAG AA gate)', () => {
    const values: ValuesMap = { 'design-audit': true };
    const expanded = applyDesignAudit(values);
    expect(expanded.check).toContain('contrast:aa');
  });

  it('auto-raises contrast-limit to 400 when unset', () => {
    const values: ValuesMap = { 'design-audit': true };
    const expanded = applyDesignAudit(values);
    expect(expanded['contrast-limit']).toBe('400');
  });

  it('leaves an explicit contrast-limit untouched', () => {
    const values: ValuesMap = { 'design-audit': true, 'contrast-limit': '50' };
    const expanded = applyDesignAudit(values);
    expect(expanded['contrast-limit']).toBe('50');
  });
});

describe('--contrast-limit auto-raise for bare --check "contrast:aa"/"contrast:aaa"', () => {
  it('raises contrast-limit to 400 for a bare --check "contrast:aa" (no --design-audit)', () => {
    const expanded = applyDesignAudit({ check: 'contrast:aa' });
    expect(expanded['contrast-limit']).toBe('400');
  });

  it('leaves an explicit contrast-limit untouched even with --check "contrast:aa"', () => {
    const expanded = applyDesignAudit({ check: 'contrast:aa', 'contrast-limit': '50' });
    expect(expanded['contrast-limit']).toBe('50');
  });

  it('also raises for contrast:aaa', () => {
    const expanded = applyDesignAudit({ check: 'contrast:aaa' });
    expect(expanded['contrast-limit']).toBe('400');
  });

  it('does not raise when --check has no contrast assertion (no over-matching)', () => {
    const expanded = applyDesignAudit({ check: 'no-hscroll, canonical' });
    expect(expanded['contrast-limit']).toBeUndefined();
  });

  it('--design-audit alone still raises to 400 (unchanged)', () => {
    const expanded = applyDesignAudit({ 'design-audit': true });
    expect(expanded['contrast-limit']).toBe('400');
  });

  it('--design-audit + explicit --check "contrast:aa" still raises to 400, not doubled/broken', () => {
    const expanded = applyDesignAudit({ 'design-audit': true, check: 'contrast:aa' });
    expect(expanded['contrast-limit']).toBe('400');
    // design-audit appends its own auditChecks onto the user's check string
    expect(expanded.check).toBe('contrast:aa, no generator, self-hosted-fonts, contrast:aa');
  });
});
