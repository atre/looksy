import type { SuggestInput } from './suggest.js';
import type { ContrastPairResult } from './contrast.js';

/** Build SuggestInput from previously-collected analysis jsonData.
 * Rederives SEO issues locally (formatSeo doesn't expose them), and derives heading/image/nav stats from metadata. */
export function buildSuggestInput(
  jsonData: Record<string, any> | undefined,
  contrastPairs: ContrastPairResult[] | undefined,
  fragment = false,
): SuggestInput {
  const meta = jsonData?.metadata as import('./metadata.js').PageMetadata | undefined;
  const a11y = jsonData?.a11y as import('./a11y.js').A11yData | undefined;
  const seo = jsonData?.seo as import('./seo.js').SeoData | undefined;
  const links = jsonData?.links as import('./links.js').LinkResult[] | undefined;

  const seoIssues: string[] = [];
  if (seo) {
    if (!seo.description) seoIssues.push('no meta description');
    // --fragment: a component preview has no <link rel="canonical"> by design.
    if (!seo.canonical && !fragment) seoIssues.push('no canonical URL');
    if (!seo.og['og:title']) seoIssues.push('no og:title');
    if (!seo.og['og:image']) seoIssues.push('no og:image');
    if (!seo.robotsTxt.exists) seoIssues.push('no robots.txt');
    if (!seo.sitemap.exists) seoIssues.push('no sitemap.xml');
    if (seo.generator) seoIssues.push(`generator: ${seo.generator} (fingerprint risk)`);
  }

  const headings = meta?.headings;
  const h1Count = headings?.filter((h) => h.level === 1).length;
  let headingSkips = 0;
  const headingSkipDetails: string[] = [];
  if (headings) {
    let prev: { level: number; text: string } | null = null;
    for (const h of headings) {
      if (prev && h.level > prev.level + 1) {
        headingSkips++;
        headingSkipDetails.push(
          `h${prev.level} "${prev.text.slice(0, 25)}" → h${h.level} "${h.text.slice(0, 25)}"`,
        );
      }
      prev = h;
    }
  }
  const shortName = (img: { src: string; id?: string; className?: string }) => {
    const src = img.src;
    if (!src || src.startsWith('data:')) {
      if (img.id) return `img#${img.id}`;
      if (img.className) return `img.${img.className}`;
      return 'img';
    }
    return src.split('/').pop()?.split('?')[0]?.slice(0, 40) || src.slice(0, 40);
  };
  const brokenList = meta?.images?.filter((img) => img.broken) ?? [];
  const missingAltList = meta?.images?.filter((img) => !img.hasAlt && !img.broken) ?? [];
  const brokenImgs = brokenList.length;
  const missingAlt = missingAltList.length;

  let footerLinkCount: number | undefined;
  let navLinkCount: number | undefined;
  let hasFooter: boolean | undefined;
  let hasNav: boolean | undefined;
  if (meta?.elements) {
    const footerEl = meta.elements.find((e) => e.tag === 'footer');
    hasFooter = !!footerEl;
    footerLinkCount = footerEl ? meta.links.filter(() => true).length : 0;
    const navEl = meta.elements.find((e) => e.tag === 'nav');
    hasNav = !!navEl;
  }
  const totalElements = meta?.elements?.length ?? 0;
  const belowFoldElements = meta?.elements?.filter((e) => !e.aboveFold).length ?? 0;

  return {
    contrastPairs,
    a11yIssues: a11y?.issues,
    seoIssues: seoIssues.length > 0 ? seoIssues : undefined,
    brokenImages: brokenImgs > 0 ? brokenImgs : undefined,
    brokenImageSrcs: brokenImgs > 0 ? brokenList.map((i) => shortName(i)) : undefined,
    brokenLinks: links
      ?.filter((l) => l.verdict === 'broken')
      .map((l) => ({ url: l.url, status: l.error ?? String(l.status) })),
    missingAlt: missingAlt > 0 ? missingAlt : undefined,
    missingAltSrcs: missingAlt > 0 ? missingAltList.map((i) => shortName(i)) : undefined,
    headingSkips: headingSkips > 0 ? headingSkips : undefined,
    headingSkipDetails: headingSkipDetails.length > 0 ? headingSkipDetails : undefined,
    headings,
    h1Count,
    hasFooter,
    hasNav,
    footerLinkCount,
    navLinkCount,
    totalElements,
    belowFoldElements,
  };
}
