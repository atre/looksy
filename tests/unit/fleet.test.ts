import { describe, it, expect } from 'vitest';
import { configureFleet } from '../../src/cli-utils.js';

describe('configureFleet', () => {
  it('collects positional URLs into values.urls and returns the list', () => {
    const values: Record<string, any> = {};
    const urls = configureFleet(['https://a.com', 'b.com'], values);
    expect(urls).toEqual(['https://a.com', 'b.com']);
    expect(values.urls).toBe('https://a.com,b.com');
  });

  it('applies audit defaults when no analysis flag is given', () => {
    const values: Record<string, any> = {};
    configureFleet(['https://a.com'], values);
    expect(values.contrast).toBe(true);
    expect(values.a11y).toBe(true);
    expect(values.compact).toBe(true);
  });

  it('always enables the consolidated report and the AA gate', () => {
    const values: Record<string, any> = {};
    configureFleet(['https://a.com'], values);
    expect(values['batch-report']).toBe(true);
    expect(values['fail-on-aa']).toBe(true);
  });

  it('respects explicit analysis flags and skips the defaults', () => {
    const values: Record<string, any> = { perf: true };
    configureFleet(['https://a.com'], values);
    expect(values.perf).toBe(true);
    expect(values.contrast).toBeUndefined();
    expect(values.a11y).toBeUndefined();
  });

  it('treats parseArgs false defaults as "no analysis chosen"', () => {
    // Real CLI booleans default to false (not undefined) — defaults should still apply.
    const values: Record<string, any> = { contrast: false, a11y: false, perf: false };
    configureFleet(['https://a.com'], values);
    expect(values.contrast).toBe(true);
    expect(values.a11y).toBe(true);
  });

  it('merges positional URLs with an existing --urls value', () => {
    const values: Record<string, any> = { urls: 'https://c.com, https://d.com' };
    const urls = configureFleet(['https://a.com'], values);
    expect(urls).toEqual(['https://a.com', 'https://c.com', 'https://d.com']);
    expect(values.urls).toBe('https://a.com,https://c.com,https://d.com');
  });

  it('design-audit counts as an analysis choice (no contrast/a11y defaults forced)', () => {
    const values: Record<string, any> = { 'design-audit': true };
    configureFleet(['https://a.com'], values);
    expect(values.contrast).toBeUndefined();
    expect(values.a11y).toBeUndefined();
    expect(values['design-audit']).toBe(true);
  });
});
