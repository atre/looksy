import { describe, it, expect } from 'vitest';
import {
  judgeOptimizer,
  rewriteWidth,
  formatImageOptimizer,
  type ImageOptimizerData,
} from '../../src/image-optimizer.js';

describe('rewriteWidth', () => {
  it('replaces an existing w= param', () => {
    expect(rewriteWidth('/_next/image?url=%2Fhero.png&w=1080&q=75', 64)).toBe(
      '/_next/image?url=%2Fhero.png&w=64&q=75',
    );
  });

  it('replaces an existing width= param', () => {
    expect(rewriteWidth('https://cdn.example.com/img.jpg?width=1080', 64)).toBe(
      'https://cdn.example.com/img.jpg?width=64',
    );
  });

  it('appends w= when no width param exists and other params are present', () => {
    expect(rewriteWidth('https://cdn.example.com/img.jpg?q=75', 64)).toBe(
      'https://cdn.example.com/img.jpg?q=75&w=64',
    );
  });

  it('appends ?w= when the URL has no query string at all', () => {
    expect(rewriteWidth('https://cdn.example.com/img.jpg', 64)).toBe(
      'https://cdn.example.com/img.jpg?w=64',
    );
  });
});

describe('judgeOptimizer', () => {
  it('flags equal sizes as PASS-THROUGH', () => {
    expect(judgeOptimizer(101200, 101200)).toBe('PASS-THROUGH');
  });

  it('flags sizes within 2% as PASS-THROUGH', () => {
    expect(judgeOptimizer(100000, 101500)).toBe('PASS-THROUGH');
  });

  it('flags a real resize as OK', () => {
    expect(judgeOptimizer(4200, 98800)).toBe('OK');
  });
});

describe('formatImageOptimizer', () => {
  const passThroughData: ImageOptimizerData = {
    probes: [
      {
        url: 'https://example.com/_next/image?url=%2Fhero.png&w=1080&q=75',
        verdict: 'PASS-THROUGH',
        small: { w: 64, bytes: 101171 },
        large: { w: 1080, bytes: 101171 },
      },
    ],
  };

  const okData: ImageOptimizerData = {
    probes: [
      {
        url: 'https://example.com/_next/image?url=%2Fa.png&w=1080&q=75',
        verdict: 'OK',
        small: { w: 64, bytes: 4200 },
        large: { w: 1080, bytes: 98800 },
      },
      {
        url: 'https://example.com/_next/image?url=%2Fb.png&w=1080&q=75',
        verdict: 'OK',
        small: { w: 64, bytes: 3000 },
        large: { w: 1080, bytes: 90000 },
      },
    ],
  };

  it('returns empty string when there are no probes', () => {
    expect(formatImageOptimizer({ probes: [] })).toBe('');
  });

  it('compact mode flags pass-through', () => {
    const out = formatImageOptimizer(passThroughData, { compact: true });
    expect(out).toContain('1 checked');
    expect(out).toContain('1 pass-through');
  });

  it('compact mode shows all resizing when clean', () => {
    const out = formatImageOptimizer(okData, { compact: true });
    expect(out).toContain('2 checked');
    expect(out).toContain('all resizing');
  });

  it('verbose mode lists the verdict per probe', () => {
    const out = formatImageOptimizer(passThroughData);
    expect(out).toContain('Image Optimizer');
    expect(out).toContain('PASS-THROUGH');
  });
});
