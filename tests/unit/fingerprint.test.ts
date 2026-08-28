import { describe, it, expect } from 'vitest';
import { compareFingerprints, formatFingerprintCompare, formatSimilarityMatrix, formatFingerprintDiff } from '../../dist/fingerprint.js';
import type { FingerprintData } from '../../dist/fingerprint.js';

function makeFP(overrides: Partial<FingerprintData> = {}): FingerprintData {
  return {
    url: 'https://example.com',
    capturedAt: '2024-01-01T00:00:00Z',
    domStructure: {
      headingSequence: [1, 2, 2, 3],
      sectionCount: 4,
      navCount: 1,
      footerCount: 1,
      articleCount: 0,
      formCount: 0,
      maxDepth: 8,
      totalElements: 200,
    },
    navStructure: { headerLinkCount: 5, footerLinkCount: 3, hasHeader: true, hasFooter: true, hasNav: true },
    metaTagOrder: ['charset', 'viewport', 'description', 'og:title'],
    externalOrigins: ['fonts.googleapis.com', 'cdn.jsdelivr.net'],
    hashedClasses: ['_astro_abc12', '_astro_def34'],
    topClassNames: ['flex', 'text-lg', 'container'],
    fontDomains: ['fonts.googleapis.com'],
    buildDirs: ['_astro/'],
    contentHashes: ['abc123', 'def456'],
    generator: null,
    favicon: '/favicon.ico',
    schemaTypes: [],
    fontStack: ['Inter', 'sans-serif'],
    assetFilenames: ['Component.abc12345.js', 'style.def456.css'],
    inlineScriptHashes: ['a1b2c3d4e5f60718', 'fedcba9876543210'],
    ...overrides,
  };
}

describe('compareFingerprints', () => {
  it('identical fingerprints score 100', () => {
    const a = makeFP();
    const b = makeFP({ url: 'https://other.com' });
    const result = compareFingerprints(a, b, 'site-a', 'site-b');
    expect(result.overall).toBeCloseTo(100, 0);
  });

  it('completely different fingerprints score near 0', () => {
    const a = makeFP();
    const b = makeFP({
      url: 'https://different.com',
      domStructure: { headingSequence: [1, 3, 3], sectionCount: 1, navCount: 0, footerCount: 0, articleCount: 3, formCount: 2, maxDepth: 4, totalElements: 50 },
      metaTagOrder: ['robots', 'author'],
      externalOrigins: ['analytics.example.com'],
      hashedClasses: ['_next_xyz99'],
      fontDomains: ['fonts.bunny.net'],
      buildDirs: ['_next/'],
      contentHashes: ['zzz999'],
      assetFilenames: ['chunk.xyz99.js', 'main.aaa111.css'],
    });
    const result = compareFingerprints(a, b, 'a', 'b');
    expect(result.overall).toBeLessThan(20);
  });

  it('partial overlap scores intermediate', () => {
    const a = makeFP();
    const b = makeFP({
      url: 'https://similar.com',
      hashedClasses: ['_astro_abc12', '_astro_new99'], // 1 shared
      externalOrigins: ['fonts.googleapis.com'], // 1 shared, 1 missing
    });
    const result = compareFingerprints(a, b, 'a', 'b');
    expect(result.overall).toBeGreaterThan(40);
    expect(result.overall).toBeLessThan(100);
  });
});

describe('formatFingerprintCompare', () => {
  it('compact mode shows one-liner with risk', () => {
    const a = makeFP();
    const b = makeFP({ url: 'https://other.com' });
    const result = compareFingerprints(a, b, 'site-a', 'site-b');
    const out = formatFingerprintCompare(result, { compact: true });
    expect(out).toContain('Similarity:');
    expect(out).toContain('site-a vs site-b');
  });

  it('verbose mode shows table and dimensions', () => {
    const a = makeFP();
    const b = makeFP({ url: 'https://other.com' });
    const result = compareFingerprints(a, b, 'site-a', 'site-b');
    const out = formatFingerprintCompare(result);
    expect(out).toContain('## Fingerprint Comparison');
    expect(out).toContain('Hashed Classes');
    expect(out).toContain('External Origins');
    expect(out).toContain('DOM Structure');
  });
});

describe('empty-set Jaccard and new dimensions', () => {
  it('empty sets score 0 not 100 (no false similarity)', () => {
    const a = makeFP({ hashedClasses: [], buildDirs: [], fontDomains: [], assetFilenames: [], metaTagOrder: [] });
    const b = makeFP({ url: 'https://other.com', hashedClasses: [], buildDirs: [], fontDomains: [], assetFilenames: [], metaTagOrder: [] });
    const result = compareFingerprints(a, b, 'a', 'b');
    const hcDim = result.dimensions.find((d) => d.name === 'Hashed Classes')!;
    expect(hcDim.score).toBe(0);
    expect(hcDim.detail).toContain('excluded');
    const bdDim = result.dimensions.find((d) => d.name === 'Build Dirs')!;
    expect(bdDim.score).toBe(0);
    const afDim = result.dimensions.find((d) => d.name === 'Asset Filenames')!;
    expect(afDim.score).toBe(0);
  });

  it('asset filenames dimension detects shared files', () => {
    const a = makeFP({ assetFilenames: ['client.abc123.js', 'style.def456.css'] });
    const b = makeFP({ url: 'https://other.com', assetFilenames: ['client.abc123.js', 'main.xyz789.css'] });
    const result = compareFingerprints(a, b, 'a', 'b');
    const afDim = result.dimensions.find((d) => d.name === 'Asset Filenames')!;
    expect(afDim.score).toBeGreaterThan(0);
    expect(afDim.score).toBeLessThan(1);
    expect(afDim.detail).toContain('1 shared of 3 unique');
  });
});

describe('formatSimilarityMatrix', () => {
  it('produces NxN matrix for 3 fingerprints', () => {
    const fps = [makeFP(), makeFP({ url: 'https://b.com' }), makeFP({ url: 'https://c.com', hashedClasses: [] })];
    const names = ['a', 'b', 'c'];
    const out = formatSimilarityMatrix(fps, names);
    expect(out).toContain('## Fingerprint Similarity Matrix');
    expect(out).toContain('| a');
    expect(out).toContain('| b');
    expect(out).toContain('| c');
  });
});

describe('formatFingerprintDiff', () => {
  it('shows changes between two versions', () => {
    const before = makeFP({ assetFilenames: ['old.abc123.js'] });
    const after = makeFP({
      url: 'https://example.com',
      hashedClasses: ['_astro_new99'],
      assetFilenames: ['new.xyz789.js'],
    });
    const result = compareFingerprints(before, after, 'v1', 'v2');
    const out = formatFingerprintDiff(before, after, result);
    expect(out).toContain('## Fingerprint Diff: v1 → v2');
    expect(out).toContain('Hashed Classes');
    expect(out).toContain('Removed');
    expect(out).toContain('Added');
    expect(out).toContain('Asset Filenames');
  });

  it('compact mode shows one-liner', () => {
    const before = makeFP();
    const after = makeFP({ url: 'https://example.com', hashedClasses: ['_astro_new99'] });
    const result = compareFingerprints(before, after, 'v1', 'v2');
    const out = formatFingerprintDiff(before, after, result, { compact: true });
    expect(out).toContain('Fingerprint diff: v1 → v2');
    expect(out).toContain('Changed:');
  });
});
