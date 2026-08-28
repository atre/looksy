import { describe, it, expect } from 'vitest';
import { formatBundles, type BundleData } from '../../src/bundles.js';

const sampleData: BundleData = {
  entries: [
    { name: 'main-abc123.js', url: 'https://example.com/_next/static/chunks/main-abc123.js', transferSize: 80000, decodedSize: 200000, duration: 150, category: 'framework' },
    { name: 'page-def456.js', url: 'https://example.com/_next/static/chunks/pages/page-def456.js', transferSize: 30000, decodedSize: 90000, duration: 80, category: 'page' },
    { name: 'vendor-ghi789.js', url: 'https://example.com/_next/static/chunks/vendor-ghi789.js', transferSize: 60000, decodedSize: 180000, duration: 120, category: 'vendor' },
  ],
  totalTransferSize: 170000,
  totalDecodedSize: 470000,
  largeChunks: [
    { name: 'main-abc123.js', url: '', transferSize: 80000, decodedSize: 200000, duration: 150, category: 'framework' },
    { name: 'vendor-ghi789.js', url: '', transferSize: 60000, decodedSize: 180000, duration: 120, category: 'vendor' },
  ],
  categoryBreakdown: [
    { category: 'framework', count: 1, transferSize: 80000 },
    { category: 'vendor', count: 1, transferSize: 60000 },
    { category: 'page', count: 1, transferSize: 30000 },
  ],
};

describe('formatBundles', () => {
  it('shows empty message when no bundles', () => {
    const result = formatBundles({ entries: [], totalTransferSize: 0, totalDecodedSize: 0, largeChunks: [], categoryBreakdown: [] });
    expect(result).toContain('No JS bundles');
  });

  it('compact mode shows summary', () => {
    const result = formatBundles(sampleData, { compact: true });
    expect(result).toContain('3 JS bundles');
    expect(result).toContain('2 large');
    expect(result).toContain('##');
  });

  it('verbose mode shows full table', () => {
    const result = formatBundles(sampleData);
    expect(result).toContain('JS Bundle Analysis');
    expect(result).toContain('By Category');
    expect(result).toContain('framework');
    expect(result).toContain('vendor');
    expect(result).toContain('main-abc123.js');
  });

  it('flags large chunks', () => {
    const result = formatBundles(sampleData);
    expect(result).toContain('large chunk');
    expect(result).toContain('>50KB');
  });
});
