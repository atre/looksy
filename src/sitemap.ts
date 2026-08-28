/**
 * Zero-dep sitemap.xml reader for `--pages @sitemap`. Small enough for peep to copy
 * verbatim until a shared `clikit` package exists — keep it dependency-free.
 */

export interface SitemapParseResult {
  urls: string[];
  sitemaps: string[];
}

/** Minimal XML entity decode for <loc> text content. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractLocs(xml: string, entryTag: string): string[] {
  const entryRe = new RegExp(`<${entryTag}[^>]*>([\\s\\S]*?)</${entryTag}>`, 'gi');
  const locRe = /<loc[^>]*>([\s\S]*?)<\/loc>/i;
  const locs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(xml))) {
    const locMatch = locRe.exec(match[1]);
    if (locMatch) {
      const loc = decodeXmlEntities(locMatch[1].trim());
      if (loc) locs.push(loc);
    }
  }
  return locs;
}

/**
 * Parse a sitemap.xml document. A `<urlset>` document yields `urls`; a `<sitemapindex>`
 * document (a sitemap of sitemaps) yields `sitemaps` (nested sitemap URLs to fetch next).
 * Regex-based on purpose — no XML dependency, matching this repo's zero-dep preference.
 */
export function parseSitemapXml(xml: string): SitemapParseResult {
  if (/<sitemapindex[\s>]/i.test(xml)) {
    return { urls: [], sitemaps: extractLocs(xml, 'sitemap') };
  }
  return { urls: extractLocs(xml, 'url'), sitemaps: [] };
}

/**
 * Convert absolute sitemap `<loc>` URLs into page paths. Same-origin entries collapse to
 * `pathname + search` (what --pages already expects); cross-origin entries are kept as
 * absolute URLs — `new URL(pagePath, baseUrl)` downstream handles those transparently.
 */
export function sitemapEntriesToPaths(urls: string[], origin: string): string[] {
  let originUrl: URL | undefined;
  try {
    originUrl = new URL(origin);
  } catch {
    originUrl = undefined;
  }

  return urls.map((raw) => {
    try {
      const parsed = new URL(raw);
      if (originUrl && parsed.origin === originUrl.origin) {
        return `${parsed.pathname || '/'}${parsed.search}`;
      }
      return raw;
    } catch {
      return raw;
    }
  });
}

export interface SitemapFetchResponse {
  ok: boolean;
  status?: number;
  text(): Promise<string>;
}

export interface FetchSitemapOptions {
  /** Truncate the final path list to this many entries. */
  limit?: number;
  /** Injectable fetch — defaults to the global Node fetch. Tests must always inject this. */
  fetchImpl?: (url: string) => Promise<SitemapFetchResponse>;
}

/** Hard cap on nested sitemap fetches from one index, so a pathological/looping index can't hang. */
const MAX_NESTED_SITEMAPS = 20;

/**
 * Fetch `<origin>/sitemap.xml`, following one level of sitemap-index nesting, and return
 * the page paths it lists (ready to feed into --pages' batch loop).
 */
export async function fetchSitemapPaths(
  origin: string,
  opts: FetchSitemapOptions = {},
): Promise<string[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rootUrl = `${origin.replace(/\/+$/, '')}/sitemap.xml`;

  async function fetchXml(sitemapUrl: string): Promise<string> {
    const res = await fetchImpl(sitemapUrl);
    if (!res.ok) {
      throw new Error(`Sitemap fetch failed: ${sitemapUrl} (HTTP ${res.status ?? 'unknown'})`);
    }
    return res.text();
  }

  const root = parseSitemapXml(await fetchXml(rootUrl));

  let urls = root.urls;
  if (urls.length === 0 && root.sitemaps.length > 0) {
    const nested = root.sitemaps.slice(0, MAX_NESTED_SITEMAPS);
    for (const sitemapUrl of nested) {
      const child = parseSitemapXml(await fetchXml(sitemapUrl));
      urls = urls.concat(child.urls);
    }
  }

  let paths = sitemapEntriesToPaths(urls, origin);
  if (opts.limit !== undefined) {
    paths = paths.slice(0, opts.limit);
  }
  return paths;
}
