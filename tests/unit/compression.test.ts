import { describe, it, expect } from 'vitest';
import { formatCompression, type CompressionData } from '../../src/compression.js';

const sampleData: CompressionData = {
  entries: [
    { name: 'main.js', type: 'script', encoding: 'br', transferSize: 20000, decodedSize: 80000, ratio: 0.25 },
    { name: 'style.css', type: 'link', encoding: 'gzip', transferSize: 5000, decodedSize: 15000, ratio: 0.33 },
    { name: 'vendor.js', type: 'script', encoding: 'none', transferSize: 50000, decodedSize: 50000, ratio: 1 },
  ],
  uncompressedCount: 1,
  uncompressedSize: 50000,
  brotliCount: 1,
  gzipCount: 1,
  noneCount: 1,
  potentialSavings: 35000,
};

describe('formatCompression', () => {
  it('shows empty message when no text resources', () => {
    const result = formatCompression({ entries: [], uncompressedCount: 0, uncompressedSize: 0, brotliCount: 0, gzipCount: 0, noneCount: 0, potentialSavings: 0 });
    expect(result).toContain('No text resources');
  });

  it('compact mode shows encoding counts', () => {
    const result = formatCompression(sampleData, { compact: true });
    expect(result).toContain('1 br');
    expect(result).toContain('1 gzip');
    expect(result).toContain('1 none');
    expect(result).toContain('savings');
  });

  it('verbose mode shows table', () => {
    const result = formatCompression(sampleData);
    expect(result).toContain('Compression Check');
    expect(result).toContain('main.js');
    expect(result).toContain('vendor.js');
    expect(result).toContain('uncompressed');
  });
});
