import { describe, it, expect } from 'vitest';
import { formatBatchSummary } from '../../dist/cli.js';

const clean = (url: string) => ({
  url,
  result: {
    imagePath: '/tmp/x.png',
    pageInfo: { width: 375, height: 900, title: 'Clean', viewportWidth: 375 },
  },
});

const red = (url: string) => ({
  url,
  result: {
    imagePath: '/tmp/y.png',
    pageInfo: { width: 396, height: 900, title: 'Red', viewportWidth: 375 },
  },
});

describe('formatBatchSummary', () => {
  it('default (no opts): full listing, unchanged from today', () => {
    const entries = [clean('https://a.com/'), red('https://b.com/')];
    const lines = formatBatchSummary(entries, 'pages');
    expect(lines[0]).toBe('\n--- Batch: 2 pages ---');
    expect(lines.some((l) => l === '  https://a.com/')).toBe(true);
    expect(lines.some((l) => l === '  https://b.com/')).toBe(true);
    expect(lines.some((l) => l.includes('clean'))).toBe(false);
  });

  it('failOnly: 3 pages, 1 red -> only the red block plus "2 clean"', () => {
    const entries = [clean('https://a.com/'), red('https://b.com/'), clean('https://c.com/')];
    const lines = formatBatchSummary(entries, 'pages', { failOnly: true });

    expect(lines.some((l) => l === '  https://b.com/')).toBe(true);
    expect(lines.some((l) => l.includes('396x900px') && l.includes('Red'))).toBe(true);

    expect(lines.some((l) => l.includes('https://a.com/'))).toBe(false);
    expect(lines.some((l) => l.includes('https://c.com/'))).toBe(false);

    expect(lines.some((l) => l.includes('2 clean'))).toBe(true);
  });

  it('failOnly: all clean -> header + "N clean", no per-entry blocks', () => {
    const entries = [clean('https://a.com/'), clean('https://b.com/')];
    const lines = formatBatchSummary(entries, 'pages', { failOnly: true });
    expect(lines.some((l) => l.includes('https://a.com/'))).toBe(false);
    expect(lines.some((l) => l.includes('https://b.com/'))).toBe(false);
    expect(lines.some((l) => l.includes('2 clean'))).toBe(true);
  });

  it('failOnly: all red -> "0 clean" trailing line still present', () => {
    const entries = [red('https://a.com/'), red('https://b.com/')];
    const lines = formatBatchSummary(entries, 'pages', { failOnly: true });
    expect(lines.some((l) => l === '  https://a.com/')).toBe(true);
    expect(lines.some((l) => l === '  https://b.com/')).toBe(true);
    expect(lines.some((l) => l.includes('0 clean'))).toBe(true);
  });
});
