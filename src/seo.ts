import type { Page } from 'playwright';

export interface SeoData {
  /** robots.txt status and content summary */
  robotsTxt: { exists: boolean; content?: string; lines?: number };
  /** sitemap.xml status */
  sitemap: { exists: boolean; url?: string; urlCount?: number };
  /** Open Graph tags */
  og: Record<string, string>;
  /** Twitter/X card tags */
  twitter: Record<string, string>;
  /** Canonical URL */
  canonical: string | null;
  /** hreflang entries */
  hreflang: Array<{ lang: string; href: string }>;
  /** Meta generator tag */
  generator: string | null;
  /** Meta description */
  description: string | null;
  /** Title tag */
  title: string;
  /** JSON-LD schema types */
  schemaTypes: string[];
  /** Favicon */
  favicon: string | null;
}

/**
 * SEO audit: robots.txt, sitemap.xml, og tags, canonical, hreflang, generator, schema.
 */
export async function extractSeo(page: Page): Promise<SeoData> {
  // Collect DOM-based SEO data
  const domData = await page.evaluate(() => {
    const og: Record<string, string> = {};
    const twitter: Record<string, string> = {};
    const hreflang: Array<{ lang: string; href: string }> = [];

    // OG tags
    for (const el of document.querySelectorAll('meta[property^="og:"]')) {
      const prop = el.getAttribute('property') || '';
      og[prop] = el.getAttribute('content') || '';
    }

    // Twitter tags
    for (const el of document.querySelectorAll('meta[name^="twitter:"]')) {
      const name = el.getAttribute('name') || '';
      twitter[name] = el.getAttribute('content') || '';
    }

    // Canonical
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? (canonicalEl as HTMLLinkElement).href : null;

    // hreflang
    for (const el of document.querySelectorAll('link[rel="alternate"][hreflang]')) {
      hreflang.push({
        lang: el.getAttribute('hreflang') || '',
        href: (el as HTMLLinkElement).href,
      });
    }

    // Generator
    const genEl = document.querySelector('meta[name="generator"]');
    const generator = genEl ? genEl.getAttribute('content') : null;

    // Description
    const descEl = document.querySelector('meta[name="description"]');
    const description = descEl ? descEl.getAttribute('content') : null;

    // Title
    const title = document.title;

    // JSON-LD schema types
    const schemaTypes: string[] = [];
    const seenLd = new Set<string>(); // dedupe re-injected (hydrated) duplicate blocks
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const json = JSON.parse(el.textContent || '');
        const key = JSON.stringify(json);
        if (seenLd.has(key)) continue;
        seenLd.add(key);
        const roots = Array.isArray(json) ? json : [json];
        for (const root of roots) {
          if (!root || typeof root !== 'object') continue;
          if (root['@type']) schemaTypes.push(String(root['@type']));
          if (Array.isArray(root['@graph'])) {
            for (const item of root['@graph']) {
              if (item && item['@type']) schemaTypes.push(String(item['@type']));
            }
          }
        }
      } catch {
        /* invalid JSON-LD */
      }
    }

    // Favicon
    const faviconEl = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    const favicon = faviconEl ? (faviconEl as HTMLLinkElement).href : null;

    return {
      og,
      twitter,
      canonical,
      hreflang,
      generator,
      description,
      title,
      schemaTypes,
      favicon,
    };
  });

  // Check robots.txt and sitemap.xml via fetch
  const origin = new URL(page.url()).origin;
  let robotsTxt: SeoData['robotsTxt'] = { exists: false };
  let sitemap: SeoData['sitemap'] = { exists: false };

  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const text = await robotsRes.text();
      const lines = text.split('\n').filter((l) => l.trim()).length;
      robotsTxt = { exists: true, content: text.slice(0, 500), lines };
      // Check for sitemap reference
      const sitemapMatch = text.match(/Sitemap:\s*(.+)/i);
      if (sitemapMatch) {
        sitemap.url = sitemapMatch[1].trim();
      }
    }
  } catch {
    /* robots.txt not available */
  }

  // Check sitemap.xml
  const sitemapUrl = sitemap.url || `${origin}/sitemap.xml`;
  try {
    const sitemapRes = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (sitemapRes.ok) {
      const text = await sitemapRes.text();
      const urlCount = (text.match(/<loc>/g) || []).length;
      sitemap = { exists: true, url: sitemapUrl, urlCount };
    }
  } catch {
    /* sitemap not available */
  }

  return { ...domData, robotsTxt, sitemap };
}

export function formatSeo(
  data: SeoData,
  opts: { compact?: boolean; fragment?: boolean } = {},
): string {
  const issues: string[] = [];

  if (!data.description) issues.push('no meta description');
  // --fragment: a piped component preview has no <link rel="canonical"> by design.
  if (!data.canonical && !opts.fragment) issues.push('no canonical URL');
  if (data.generator) issues.push(`generator: "${data.generator}" (fingerprint risk)`);
  if (!data.og['og:title']) issues.push('no og:title');
  if (!data.og['og:image']) issues.push('no og:image');
  if (!data.robotsTxt.exists) issues.push('no robots.txt');
  if (!data.sitemap.exists) issues.push('no sitemap.xml');

  if (opts.compact) {
    const schema = data.schemaTypes.length > 0 ? ` | Schema: ${data.schemaTypes.join(', ')}` : '';
    const hreflang = data.hreflang.length > 0 ? ` | ${data.hreflang.length} hreflang` : '';
    const issueStr = issues.length > 0 ? ` | Issues: ${issues.join('; ')}` : ' | no issues';
    return `## SEO: "${data.title}"${schema}${hreflang}${issueStr}\n`;
  }

  const lines = ['## SEO Audit\n'];
  lines.push(`**Title:** ${data.title}`);
  if (data.description) lines.push(`**Description:** ${data.description.slice(0, 160)}`);
  if (data.canonical) lines.push(`**Canonical:** ${data.canonical}`);
  if (data.generator)
    lines.push(`**Generator:** ${data.generator} ⚠️ (fingerprint risk — remove in production)`);
  if (data.favicon) lines.push(`**Favicon:** ${data.favicon}`);

  // OG tags
  if (Object.keys(data.og).length > 0) {
    lines.push('\n### Open Graph\n');
    for (const [key, val] of Object.entries(data.og)) {
      lines.push(`- \`${key}\`: ${val.slice(0, 100)}`);
    }
  }

  // Twitter tags
  if (Object.keys(data.twitter).length > 0) {
    lines.push('\n### Twitter Card\n');
    for (const [key, val] of Object.entries(data.twitter)) {
      lines.push(`- \`${key}\`: ${val.slice(0, 100)}`);
    }
  }

  // hreflang
  if (data.hreflang.length > 0) {
    lines.push('\n### hreflang\n');
    for (const h of data.hreflang) {
      lines.push(`- \`${h.lang}\` → ${h.href}`);
    }
  }

  // Schema
  if (data.schemaTypes.length > 0) {
    lines.push(`\n### JSON-LD Schema\n`);
    lines.push(`Types: ${data.schemaTypes.join(', ')}`);
  }

  // robots.txt
  lines.push('\n### robots.txt\n');
  if (data.robotsTxt.exists) {
    lines.push(`Found (${data.robotsTxt.lines} directives)`);
  } else {
    lines.push('Not found');
  }

  // sitemap
  lines.push('\n### Sitemap\n');
  if (data.sitemap.exists) {
    lines.push(`Found: ${data.sitemap.url} (${data.sitemap.urlCount} URLs)`);
  } else {
    lines.push('Not found');
  }

  // Issues
  if (issues.length > 0) {
    lines.push('\n### Issues\n');
    for (const issue of issues) {
      lines.push(`- ⚠️ ${issue}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
