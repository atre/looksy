import { describe, it, expect } from 'vitest';
import { summarize } from '../../src/analysis-summary.js';

describe('summarize', () => {
  it('renders captured perf metrics with units', () => {
    const out = summarize('perf', {
      fcp: 183,
      lcp: 421,
      cls: 0.01,
      ttfb: 92,
      resourceCount: 42,
      totalTransferSize: 524288,
    });
    expect(out).toBe('perf: FCP 183ms, LCP 421ms, CLS 0.01, TTFB 92ms, 42 reqs 512KB');
  });

  it('shows em dash for perf metrics that were not captured', () => {
    const out = summarize('perf', {
      fcp: 183,
      lcp: undefined,
      cls: undefined,
      ttfb: undefined,
      resourceCount: 1,
      totalTransferSize: 0,
    });
    expect(out).toBe('perf: FCP 183ms, LCP —, CLS —, TTFB —, 1 reqs 0KB');
  });

  it('treats CLS of 0 as a real value, not missing', () => {
    const out = summarize('perf', {
      fcp: 100,
      lcp: 200,
      cls: 0,
      ttfb: 50,
      resourceCount: 3,
      totalTransferSize: 0,
    });
    expect(out).toContain('CLS 0,');
  });

  it('summarizes a11y issue and landmark counts (singular/plural)', () => {
    expect(
      summarize('a11y', { issues: [], landmarks: [{}, {}], headings: [], interactiveCount: {} }),
    ).toBe('a11y: 0 issues, 2 landmarks');
    expect(
      summarize('a11y', { issues: ['x'], landmarks: [{}], headings: [], interactiveCount: {} }),
    ).toBe('a11y: 1 issue, 1 landmark');
  });

  it('summarizes contrast failures', () => {
    expect(summarize('contrast', { aaFailures: 3, aaaFailures: 7, pairs: new Array(18) })).toBe(
      'contrast: 3 AA fail, 7 AAA fail (18 checked)',
    );
  });

  it('leads with the invisible count when present', () => {
    expect(
      summarize('contrast', {
        aaFailures: 2,
        aaaFailures: 9,
        invisibleFailures: 1,
        pairs: new Array(18),
      }),
    ).toBe('contrast: 1 invisible, 2 AA fail, 9 AAA fail (18 checked)');
  });

  it('omits the invisible fragment when invisibleFailures is 0 or absent', () => {
    expect(
      summarize('contrast', {
        aaFailures: 2,
        aaaFailures: 9,
        invisibleFailures: 0,
        pairs: new Array(18),
      }),
    ).toBe('contrast: 2 AA fail, 9 AAA fail (18 checked)');
  });

  it('appends unchecked coverage when the contrast sample was capped', () => {
    expect(
      summarize('contrast', {
        aaFailures: 0,
        aaaFailures: 0,
        pairs: new Array(150),
        sampled: 150,
        total: 311,
        capped: true,
      }),
    ).toBe(
      'contrast: 0 AA fail, 0 AAA fail (150 checked, 161 unchecked — raise with --contrast-limit)',
    );
  });

  it('surfaces the --contrast-limit hint for a capped design-audit-scale sample', () => {
    expect(
      summarize('contrast', {
        aaFailures: 2,
        aaaFailures: 9,
        sampled: 150,
        total: 719,
        capped: true,
        pairs: [],
      }),
    ).toBe(
      'contrast: 2 AA fail, 9 AAA fail (150 checked, 569 unchecked — raise with --contrast-limit)',
    );
  });

  it('omits coverage when the sample was not capped', () => {
    expect(
      summarize('contrast', {
        aaFailures: 1,
        aaaFailures: 2,
        pairs: new Array(40),
        sampled: 40,
        total: 40,
        capped: false,
      }),
    ).toBe('contrast: 1 AA fail, 2 AAA fail (40 checked)');
  });

  it('summarizes dom stats', () => {
    expect(summarize('domStats', { totalElements: 540, maxDepth: 14, inlineStyles: 2 })).toBe(
      'dom: 540 elements, depth 14, 2 inline styles',
    );
  });

  it('summarizes fonts with unique families and truncation', () => {
    const fonts = [
      { family: 'Inter', weight: '400', style: 'normal', status: 'loaded' },
      { family: 'Inter', weight: '700', style: 'normal', status: 'loaded' },
    ];
    expect(summarize('fonts', fonts)).toBe('fonts: 2 (Inter)');
    expect(summarize('fonts', [])).toBe('fonts: none detected');
  });

  it('summarizes broken and unverifiable links', () => {
    expect(
      summarize('links', [
        { ok: false, verdict: 'broken', status: 404 },
        { ok: false, verdict: 'broken', status: 500 },
        { ok: true, verdict: 'ok', status: 200 },
      ]),
    ).toBe('links: 2/3 broken, 0 unverifiable');
  });

  it('never counts unverifiable links as broken', () => {
    expect(
      summarize('links', [
        { ok: false, verdict: 'unverifiable', status: 999 },
        { ok: true, verdict: 'ok', status: 200 },
      ]),
    ).toBe('links: 0/2 broken, 1 unverifiable');
  });

  it('returns undefined for unknown keys and missing data', () => {
    expect(summarize('does-not-exist', {})).toBeUndefined();
    expect(summarize('perf', null)).toBeUndefined();
  });

  it('names cache-audit offenders largest-first, capped by limit', () => {
    const out = summarize(
      'cacheAudit',
      {
        noCacheCount: 2,
        shortTtlCount: 0,
        totalResources: 9,
        entries: [
          { name: 'a.js', issue: 'hashed asset not cached', transferSize: 100 },
          { name: 'b.css', issue: 'static asset not cached', transferSize: 50 },
          { name: 'c.png', issue: null },
        ],
      },
      { limit: 1 },
    );
    expect(out).toBe('cache: 2 no-cache, 0 short-ttl (9 resources) — a.js … and 1 more');
  });

  it('omits the offender suffix when cache-audit has no issues', () => {
    const out = summarize('cacheAudit', {
      noCacheCount: 0,
      shortTtlCount: 0,
      totalResources: 3,
      entries: [{ name: 'a.js', issue: null, transferSize: 10 }],
    });
    expect(out).toBe('cache: 0 no-cache, 0 short-ttl (3 resources)');
  });

  it('names resource-hints offenders', () => {
    const out = summarize('resourceHints', {
      existing: [],
      missingPreconnects: ['https://fonts.gstatic.com'],
      unusedPreloads: [],
    });
    expect(out).toBe(
      'resource-hints: 0 hints, 1 missing preconnect, 0 unused — https://fonts.gstatic.com',
    );
  });

  it('names compression offenders largest-first', () => {
    const out = summarize(
      'compression',
      {
        noneCount: 2,
        brotliCount: 1,
        gzipCount: 0,
        entries: [
          { name: 'small.js', encoding: 'none', decodedSize: 100 },
          { name: 'big.js', encoding: 'none', decodedSize: 500 },
          { name: 'vendor.js', encoding: 'br', decodedSize: 900 },
        ],
      },
      { limit: 10 },
    );
    expect(out).toBe('compression: 2 uncompressed, 1 brotli, 0 gzip — big.js, small.js');
  });

  it('names image-audit offenders largest-first, skipping non-flagged images', () => {
    const out = summarize('imageAudit', {
      totalCount: 3,
      totalTransferSize: 1024,
      issues: [{ severity: 'high', message: 'x' }],
      images: [
        {
          name: 'ok.png',
          transferSize: 5000,
          oversized: false,
          missingDimensions: false,
          isSvg: false,
          aboveFold: true,
          loading: 'eager',
        },
        {
          name: 'big.png',
          transferSize: 2000,
          oversized: true,
          missingDimensions: false,
          isSvg: false,
          aboveFold: false,
          loading: 'eager',
        },
        {
          name: 'small.png',
          transferSize: 100,
          oversized: true,
          missingDimensions: false,
          isSvg: false,
          aboveFold: false,
          loading: 'eager',
        },
      ],
    });
    expect(out).toBe('images: 3 images, 1KB, 1 issues — big.png, small.png');
  });

  it('summarizes an image-optimizer pass-through probe', () => {
    const out = summarize('imageOptimizer', {
      verdict: 'PASS-THROUGH',
      small: { w: 64, bytes: 101171 },
      large: { w: 1080, bytes: 101171 },
    });
    expect(out).toBe('image-optimizer: PASS-THROUGH (w=64 and w=1080 both 99KB)');
  });

  it('summarizes image-optimizer probes that all resize', () => {
    const out = summarize('imageOptimizer', {
      probes: [
        { verdict: 'OK', small: { w: 64, bytes: 4200 }, large: { w: 1080, bytes: 98800 } },
        { verdict: 'OK', small: { w: 64, bytes: 3000 }, large: { w: 1080, bytes: 90000 } },
      ],
    });
    expect(out).toBe('image-optimizer: OK (2 checked)');
  });

  it('returns undefined for image-optimizer with no probes', () => {
    expect(summarize('imageOptimizer', { probes: [] })).toBeUndefined();
  });

  it('names bundles offenders largest-first', () => {
    const out = summarize('bundles', {
      entries: [{}, {}],
      totalTransferSize: 204800,
      largeChunks: [
        { name: 'app.js', transferSize: 60000 },
        { name: 'vendor.js', transferSize: 120000 },
      ],
    });
    expect(out).toBe('bundles: 2 chunks, 200KB, 2 large — vendor.js, app.js');
  });
});
