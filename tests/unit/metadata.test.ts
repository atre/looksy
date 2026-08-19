import { describe, it, expect } from 'vitest';
import { formatMetadata, type PageMetadata } from '../../dist/metadata.js';
import { formatPerf, type PerfMetrics } from '../../dist/perf.js';

function makeMetadata(overrides: Partial<PageMetadata> = {}): PageMetadata {
  return {
    title: 'Test Page',
    viewport: { width: 1280, height: 800 },
    pageHeight: 2000,
    headings: [],
    colors: [],
    fonts: [],
    consoleErrors: [],
    images: [],
    links: [],
    elements: [],
    ...overrides,
  };
}

describe('formatMetadata', () => {
  it('renders a looksy-tagged CSP error verbatim under ## Errors (compact)', () => {
    const err = `Refused to apply inline style because it violates the following Content Security Policy directive: "style-src 'self'" (looksy)`;
    const out = formatMetadata(makeMetadata({ consoleErrors: [err] }), { compact: true });
    expect(out).toContain('## Errors');
    expect(out).toMatch(/Refused to apply inline style.* \(looksy\)$/m);
  });

  it('formats empty metadata without crashing', () => {
    const result = formatMetadata(makeMetadata());
    expect(result).toContain('# Page Metadata: Test Page');
    expect(result).toContain('1280x800');
  });

  it('includes heading hierarchy', () => {
    const result = formatMetadata(makeMetadata({
      headings: [
        { level: 1, text: 'Welcome' },
        { level: 2, text: 'About' },
      ],
    }));
    expect(result).toContain('## Heading Hierarchy');
    expect(result).toContain('H1: Welcome');
    expect(result).toContain('H2: About');
  });

  it('includes console errors', () => {
    const result = formatMetadata(makeMetadata({
      consoleErrors: ['TypeError: foo is not a function'],
    }));
    expect(result).toContain('Console Errors');
    expect(result).toContain('TypeError: foo is not a function');
  });

  it('compact mode produces shorter output', () => {
    const meta = makeMetadata({
      headings: [{ level: 1, text: 'Title' }],
      colors: [{ property: 'color', value: 'rgb(255,0,0)', element: 'h1' }],
      consoleErrors: ['Error'],
    });
    const full = formatMetadata(meta);
    const compact = formatMetadata(meta, { compact: true });
    expect(compact.length).toBeLessThan(full.length);
  });

  it('shows broken images', () => {
    const result = formatMetadata(makeMetadata({
      images: [{ src: 'logo.png', alt: 'Logo', broken: true, naturalWidth: 0, naturalHeight: 0, displayWidth: 100, displayHeight: 50, format: 'png' }],
    }));
    expect(result).toContain('Broken Images');
    expect(result).toContain('logo.png');
  });
});

describe('formatPerf', () => {
  it('formats good metrics with table', () => {
    const metrics: PerfMetrics = {
      fcp: 500,
      lcp: 1200,
      cls: 0.05,
      ttfb: 100,
      domContentLoaded: 800,
      load: 1500,
      resourceCount: 25,
      totalTransferSize: 512000,
    };
    const result = formatPerf(metrics);
    expect(result).toContain('## Performance Metrics');
    expect(result).toContain('Good');
    expect(result).toContain('500ms');
  });

  it('flags poor metrics', () => {
    const metrics: PerfMetrics = {
      fcp: 5000,
      lcp: 8000,
      cls: 0.5,
      ttfb: 3000,
      resourceCount: 100,
      totalTransferSize: 5000000,
    };
    const result = formatPerf(metrics);
    expect(result).toContain('Poor');
  });

  it('compact mode produces one-liner', () => {
    const metrics: PerfMetrics = {
      fcp: 500,
      lcp: 1200,
      cls: 0.05,
      ttfb: 100,
      resourceCount: 10,
      totalTransferSize: 100000,
    };
    const result = formatPerf(metrics, { compact: true });
    expect(result).toContain('## Perf:');
    expect(result).toContain('FCP=500ms');
    // Compact should be shorter
    const full = formatPerf(metrics);
    expect(result.length).toBeLessThan(full.length);
  });
});
