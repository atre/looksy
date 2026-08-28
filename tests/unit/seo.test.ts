import { describe, it, expect } from 'vitest';
import { formatSeo, type SeoData } from '../../dist/seo.js';

function makeData(overrides: Partial<SeoData> = {}): SeoData {
  return {
    title: 'Test Page',
    description: 'A test page description',
    canonical: 'https://example.com/',
    generator: null,
    favicon: 'https://example.com/favicon.ico',
    og: { 'og:title': 'Test Page', 'og:image': 'https://example.com/og.png' },
    twitter: {},
    hreflang: [],
    schemaTypes: ['Organization', 'WebPage'],
    robotsTxt: { exists: true, lines: 5 },
    sitemap: { exists: true, url: 'https://example.com/sitemap.xml', urlCount: 42 },
    ...overrides,
  };
}

describe('formatSeo', () => {
  it('compact mode produces one-liner with schema', () => {
    const result = formatSeo(makeData(), { compact: true });
    expect(result).toContain('## SEO:');
    expect(result).toContain('Schema: Organization, WebPage');
    expect(result).toContain('no issues');
  });

  it('compact mode flags issues', () => {
    const result = formatSeo(makeData({ description: null, generator: 'Astro v4.0' }), {
      compact: true,
    });
    expect(result).toContain('no meta description');
    expect(result).toContain('generator');
  });

  it('verbose mode includes full sections', () => {
    const result = formatSeo(makeData());
    expect(result).toContain('## SEO Audit');
    expect(result).toContain('Open Graph');
    expect(result).toContain('robots.txt');
    expect(result).toContain('Sitemap');
    expect(result).toContain('42 URLs');
  });

  it('flags generator as fingerprint risk', () => {
    const result = formatSeo(makeData({ generator: 'Astro v4.0' }));
    expect(result).toContain('Astro v4.0');
    expect(result).toContain('fingerprint risk');
  });

  it('flags missing canonical URL by default', () => {
    const result = formatSeo(makeData({ canonical: null }), { compact: true });
    expect(result).toContain('no canonical URL');
  });

  it('--fragment suppresses missing canonical URL', () => {
    const result = formatSeo(makeData({ canonical: null }), { compact: true, fragment: true });
    expect(result).not.toContain('no canonical URL');
  });

  it('--fragment does not suppress other issues (e.g. missing description)', () => {
    const result = formatSeo(makeData({ canonical: null, description: null }), {
      compact: true,
      fragment: true,
    });
    expect(result).toContain('no meta description');
    expect(result).not.toContain('no canonical URL');
  });
});
