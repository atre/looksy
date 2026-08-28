import { describe, it, expect } from 'vitest';
import { formatSuggestions } from '../../src/suggest.js';
import { buildSuggestInput } from '../../src/screenshot-suggest.js';
import type { ContrastPairResult } from '../../src/contrast.js';

describe('formatSuggestions', () => {
  it('returns empty when no issues', () => {
    const out = formatSuggestions({});
    expect(out).toContain('None');
  });

  it('generates contrast fix suggestions for AA failures', () => {
    const failingPair: ContrastPairResult = {
      tag: 'p',
      text: 'Some body text',
      className: 'text-muted',
      color: 'rgb(180, 180, 180)',
      bg: 'rgb(255, 255, 255)',
      ratio: 1.9,
      aaPass: false,
      aaaPass: false,
    };
    const out = formatSuggestions({ contrastPairs: [failingPair] });
    expect(out).toContain('[HIGH]');
    expect(out.toLowerCase()).toContain('contrast');
  });

  it('generates a11y suggestions for known issue patterns', () => {
    const out = formatSuggestions({
      a11yIssues: ['3 images missing alt text', 'missing lang attribute'],
    });
    expect(out).toContain('[MEDIUM]');
    expect(out.toLowerCase()).toContain('a11y');
  });

  it('compact mode skips LOW priority items', () => {
    const out = formatSuggestions(
      { seoIssues: ['no meta description', 'no sitemap.xml'] },
      { compact: true },
    );
    expect(out).not.toContain('[LOW]');
  });
});

describe('buildSuggestInput: alt="" is not missing alt', () => {
  it('only counts images with no alt attribute at all', () => {
    const jsonData = {
      metadata: {
        images: [
          { src: '/hero.webp', alt: '', hasAlt: true, broken: false },
          { src: '/logo.svg', alt: '', hasAlt: false, broken: false },
        ],
      },
    };
    const input = buildSuggestInput(jsonData, undefined);
    expect(input.missingAlt).toBe(1);
    expect(input.missingAltSrcs).toEqual(['logo.svg']);
  });

  it('falls back to id/class selector when src is data: or empty', () => {
    const jsonData = {
      metadata: {
        images: [
          { src: 'data:image/png;base64,abc', alt: '', hasAlt: false, broken: false, id: 'logo' },
          { src: '', alt: '', hasAlt: false, broken: false, className: 'icon' },
        ],
      },
    };
    const input = buildSuggestInput(jsonData, undefined);
    expect(input.missingAltSrcs).toEqual(['img#logo', 'img.icon']);
  });
});
