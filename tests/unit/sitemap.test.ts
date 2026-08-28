import { describe, it, expect, vi } from 'vitest';
import { parseSitemapXml, sitemapEntriesToPaths, fetchSitemapPaths } from '../../src/sitemap.js';

const URLSET_3 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://a.com/</loc></url>
  <url><loc>https://a.com/about</loc></url>
  <url><loc>https://a.com/pricing?ref=nav&amp;utm=x</loc></url>
</urlset>`;

const SITEMAP_INDEX_1 = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://a.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

describe('parseSitemapXml', () => {
  it('parses a urlset into 3 urls', () => {
    const result = parseSitemapXml(URLSET_3);
    expect(result.urls.length).toBe(3);
    expect(result.sitemaps.length).toBe(0);
    expect(result.urls).toContain('https://a.com/pricing?ref=nav&utm=x');
  });

  it('parses a sitemapindex into 1 nested sitemap', () => {
    const result = parseSitemapXml(SITEMAP_INDEX_1);
    expect(result.sitemaps.length).toBe(1);
    expect(result.urls.length).toBe(0);
    expect(result.sitemaps[0]).toBe('https://a.com/sitemap-pages.xml');
  });
});

describe('sitemapEntriesToPaths', () => {
  it('collapses same-origin urls to pathname+search', () => {
    const paths = sitemapEntriesToPaths(
      ['https://a.com/', 'https://a.com/about', 'https://a.com/pricing?ref=nav'],
      'https://a.com',
    );
    expect(paths).toEqual(['/', '/about', '/pricing?ref=nav']);
  });

  it('keeps cross-origin urls absolute', () => {
    const paths = sitemapEntriesToPaths(['https://other.com/blog'], 'https://a.com');
    expect(paths).toEqual(['https://other.com/blog']);
  });
});

describe('fetchSitemapPaths', () => {
  function makeFetchImpl() {
    return vi.fn(async (url: string) => {
      if (url === 'https://a.com/sitemap.xml') {
        return { ok: true, status: 200, text: async () => SITEMAP_INDEX_1 };
      }
      if (url === 'https://a.com/sitemap-pages.xml') {
        return { ok: true, status: 200, text: async () => URLSET_3 };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('resolves an index sitemap + 1 nested sitemap with 3 urls to 3 routes', async () => {
    const fetchImpl = makeFetchImpl();
    const paths = await fetchSitemapPaths('https://a.com', { fetchImpl });
    expect(paths.length).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith('https://a.com/sitemap.xml');
    expect(fetchImpl).toHaveBeenCalledWith('https://a.com/sitemap-pages.xml');
  });

  it('--pages-limit 2 truncates the same fixture to 2 routes', async () => {
    const fetchImpl = makeFetchImpl();
    const paths = await fetchSitemapPaths('https://a.com', { fetchImpl, limit: 2 });
    expect(paths.length).toBe(2);
  });

  it('throws a clear error on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    await expect(fetchSitemapPaths('https://a.com', { fetchImpl })).rejects.toThrow(
      /Sitemap fetch failed: https:\/\/a\.com\/sitemap\.xml \(HTTP 404\)/,
    );
  });

  it('reads a flat urlset directly with no nested fetch', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://a.com/sitemap.xml');
      return { ok: true, status: 200, text: async () => URLSET_3 };
    });
    const paths = await fetchSitemapPaths('https://a.com', { fetchImpl });
    expect(paths).toEqual(['/', '/about', '/pricing?ref=nav&utm=x']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
