import { suggestContrastFix, type ContrastPairResult } from './contrast.js';

export interface SuggestInput {
  contrastPairs?: ContrastPairResult[];
  a11yIssues?: string[];
  seoIssues?: string[];
  brokenImages?: number;
  /** Filenames/srcs of the broken images (first few) — so the finding names the element. */
  brokenImageSrcs?: string[];
  brokenLinks?: Array<{ url: string; status: string }>;
  missingAlt?: number;
  /** Filenames/srcs of images with no `alt` attribute at all (first few) — `alt=""` is decorative
   *  and intentionally excluded, not a miss. */
  missingAltSrcs?: string[];
  headingSkips?: number;
  /** Human-readable skip descriptions, e.g. `h1 "Alle Produkte" → h3 "Sofa"`. */
  headingSkipDetails?: string[];
  // Design-level inputs (from metadata)
  headings?: Array<{ level: number; text: string }>;
  footerLinkCount?: number;
  navLinkCount?: number;
  hasFooter?: boolean;
  hasNav?: boolean;
  totalElements?: number;
  belowFoldElements?: number;
  h1Count?: number;
}

interface Suggestion {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  suggestion: string;
}

/** " (a.png, b.jpg, …)" — names the flagged elements so a count is actionable. */
function listNames(names: string[] | undefined, max = 4): string {
  if (!names || names.length === 0) return '';
  const shown = names.slice(0, max);
  return ` (${shown.join(', ')}${names.length > max ? ', …' : ''})`;
}

function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Map a known a11y issue string to an actionable fix recommendation.
 * Returns null if the issue doesn't match a known pattern.
 */
function a11yIssueToFix(issue: string): string | null {
  const countedFixes: Array<[RegExp, (n: string) => string]> = [
    [
      /(\d+) image[s]? missing alt text/,
      (n) =>
        `${n} image(s) missing alt — add alt="" for decorative or descriptive text for informational`,
    ],
    [
      /(\d+) link[s]? with no accessible text/,
      (n) => `${n} link(s) with no accessible text — add aria-label or visible text inside <a>`,
    ],
    [
      /(\d+) button[s]? with no accessible text/,
      (n) =>
        `${n} button(s) with no accessible text — add aria-label or visible text inside <button>`,
    ],
    [
      /(\d+) input[s]? without associated label/,
      (n) => `${n} input(s) without label — use <label for="id"> or aria-label on each input`,
    ],
  ];
  for (const [pattern, fix] of countedFixes) {
    const m = issue.match(pattern);
    if (m) return fix(m[1]);
  }
  // Missing lang attribute
  if (/missing lang attribute/i.test(issue)) {
    return 'Missing lang attribute on <html> — add lang="en" (or appropriate locale)';
  }
  // No skip nav link
  if (/no skip navigation link/i.test(issue)) {
    return 'No skip navigation link — add <a href="#main" class="sr-only">Skip to main content</a> as first element';
  }
  // Heading level skipped
  if (/heading level skipped/i.test(issue)) {
    const m = issue.match(/h(\d+)(?:\s+"[^"]*")?\s*→\s*h(\d+)/i);
    if (m) {
      const named = issue.match(/h\d+\s+"[^"]*"\s*→\s*h\d+\s+"[^"]*"/i)?.[0];
      return `Heading levels skip from H${m[1]}→H${m[2]}${named ? ` (${named})` : ''} — add intermediate H${parseInt(m[1]) + 1} or promote heading level`;
    }
    return 'Heading levels are skipped — ensure heading hierarchy is sequential (H1→H2→H3)';
  }
  // Multiple H1s
  const h1Match = issue.match(/(\d+) H1 elements found/i);
  if (h1Match) {
    return `${h1Match[1]} H1 elements found — use exactly one H1 per page as the primary heading`;
  }
  // No H1
  if (/no H1 element found/i.test(issue)) {
    return 'No H1 found — add a primary heading that describes the page content';
  }
  // No ARIA landmarks
  if (/no aria landmarks/i.test(issue)) {
    return 'No ARIA landmarks — wrap content in semantic elements: <header>, <nav>, <main>, <footer>';
  }
  // Fall through: return issue as-is (already actionable or unknown pattern)
  return null;
}

/**
 * Map a known SEO issue string to an actionable fix recommendation.
 * Returns null if no specific fix is known.
 */
function seoIssueToFix(issue: string): string | null {
  if (/no meta description/i.test(issue)) {
    return 'add <meta name="description" content="..."> for search visibility (150-160 chars)';
  }
  if (/no canonical url/i.test(issue)) {
    return 'add <link rel="canonical" href="https://yourdomain.com/page"> to prevent duplicate content';
  }
  if (/no og:title/i.test(issue)) {
    return 'add <meta property="og:title" content="Page Title"> for social sharing previews';
  }
  if (/no og:image/i.test(issue)) {
    return 'add <meta property="og:image" content="https://..."> for social sharing image (1200x630px recommended)';
  }
  if (/no robots\.txt/i.test(issue)) {
    return 'add /robots.txt — at minimum: "User-agent: *\\nAllow: /"';
  }
  if (/no sitemap\.xml/i.test(issue)) {
    return 'add /sitemap.xml and reference it from robots.txt via "Sitemap: https://yourdomain.com/sitemap.xml"';
  }
  if (/generator/i.test(issue)) {
    return `remove ${issue.replace(' (fingerprint risk)', '')} — generator tag reveals your tech stack`;
  }
  return null;
}

/**
 * Generate prioritized, actionable fix recommendations.
 * Each suggestion includes the exact fix, not just the problem.
 * Output is ~100-200 tokens.
 */
export function formatSuggestions(data: SuggestInput, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? false;
  const suggestions: Suggestion[] = [];

  // HIGH: Contrast AA failures — deduplicated by color pair
  if (data.contrastPairs) {
    const aaFailures = data.contrastPairs.filter((p) => !p.aaPass);
    const seenColorPairs = new Set<string>();
    for (const pair of aaFailures) {
      const colorKey = `${pair.color}|${pair.bg}`;
      if (seenColorPairs.has(colorKey)) continue;
      seenColorPairs.add(colorKey);

      const fg = parseRgb(pair.color);
      const bg = parseRgb(pair.bg);
      const selector = pair.className ? `.${pair.className.split(/\s+/)[0]}` : pair.tag;
      const src = pair.source ? ` (${pair.source})` : '';

      if (fg && bg) {
        const fix = suggestContrastFix(fg, bg, 4.5);
        if (fix) {
          const side = fix.type === 'bg' ? 'bg' : 'text';
          const desc = `${fix.direction} ${side} to \`${fix.hex}\` for ${fix.ratio.toFixed(1)}:1`;
          suggestions.push({
            priority: 'HIGH',
            category: 'contrast',
            suggestion: `\`${selector}\`${src} — ${desc} (currently ${pair.ratio.toFixed(1)}:1, need 4.5:1)`,
          });
        } else {
          suggestions.push({
            priority: 'HIGH',
            category: 'contrast',
            suggestion: `\`${selector}\`${src} — ratio ${pair.ratio.toFixed(1)}:1 fails AA — no single-color tweak reaches 4.5:1, adjust both fg and bg`,
          });
        }
      } else {
        suggestions.push({
          priority: 'HIGH',
          category: 'contrast',
          suggestion: `\`${selector}\` "${pair.text}"${src} — ratio ${pair.ratio.toFixed(1)}:1 fails AA (need 4.5:1)`,
        });
      }
    }
  }

  // HIGH: Broken images
  if (data.brokenImages && data.brokenImages > 0) {
    suggestions.push({
      priority: 'HIGH',
      category: 'images',
      suggestion: `${data.brokenImages} broken image${data.brokenImages > 1 ? 's' : ''}${listNames(data.brokenImageSrcs)} — check src paths and ensure assets are deployed`,
    });
  }

  // MEDIUM: Missing alt text (explicit count takes precedence over a11y issues duplicate)
  if (data.missingAlt && data.missingAlt > 0) {
    suggestions.push({
      priority: 'MEDIUM',
      category: 'a11y',
      suggestion: `${data.missingAlt} image${data.missingAlt > 1 ? 's' : ''} missing alt${listNames(data.missingAltSrcs)} — add alt="" for decorative or descriptive text for informational`,
    });
  }

  // MEDIUM: Heading skips (explicit count)
  if (data.headingSkips && data.headingSkips > 0) {
    suggestions.push({
      priority: 'MEDIUM',
      category: 'a11y',
      suggestion: `${data.headingSkips} heading level skip${data.headingSkips > 1 ? 's' : ''}${data.headingSkipDetails?.length ? ` (${data.headingSkipDetails.slice(0, 3).join('; ')})` : ''} — ensure sequential hierarchy (H1→H2→H3, no gaps)`,
    });
  }

  // MEDIUM: A11y issues — map each to an actionable fix
  if (data.a11yIssues) {
    // Track which issues we've already covered via explicit fields to avoid duplicates
    const skipPatterns = [
      data.missingAlt ? /image[s]? missing alt text/ : null,
      data.headingSkips ? /heading level skipped/ : null,
    ].filter(Boolean) as RegExp[];

    for (const issue of data.a11yIssues) {
      const alreadyCovered = skipPatterns.some((p) => p.test(issue));
      if (alreadyCovered) continue;

      const fix = a11yIssueToFix(issue);
      suggestions.push({
        priority: 'MEDIUM',
        category: 'a11y',
        suggestion: fix ?? issue,
      });
    }
  }

  // LOW: SEO issues
  if (data.seoIssues) {
    for (const issue of data.seoIssues) {
      const fix = seoIssueToFix(issue);
      suggestions.push({
        priority: 'LOW',
        category: 'seo',
        suggestion: fix ?? issue,
      });
    }
  }

  // LOW: Broken links
  if (data.brokenLinks && data.brokenLinks.length > 0) {
    for (const link of data.brokenLinks) {
      suggestions.push({
        priority: 'LOW',
        category: 'links',
        suggestion: `broken link ${link.url} (${link.status}) — fix href or remove`,
      });
    }
  }

  // MEDIUM: Design-level heading hierarchy issues
  if (data.headings && data.headings.length > 0) {
    let prevLevel = 0;
    const skips: string[] = [];
    for (const h of data.headings) {
      if (prevLevel > 0 && h.level > prevLevel + 1) {
        skips.push(`H${prevLevel}→H${h.level}`);
      }
      prevLevel = h.level;
    }
    if (skips.length > 0 && !data.headingSkips) {
      suggestions.push({
        priority: 'MEDIUM',
        category: 'design',
        suggestion: `heading hierarchy skips: ${skips.join(', ')} — use sequential levels (H1→H2→H3)`,
      });
    }
  }

  // MEDIUM: Multiple or missing H1
  if (data.h1Count !== undefined) {
    if (data.h1Count === 0) {
      suggestions.push({
        priority: 'MEDIUM',
        category: 'design',
        suggestion: 'no H1 found — add a primary heading that describes the page content',
      });
    } else if (data.h1Count > 1) {
      suggestions.push({
        priority: 'MEDIUM',
        category: 'design',
        suggestion: `${data.h1Count} H1 elements — use exactly one H1 per page`,
      });
    }
  }

  // LOW: Sparse footer
  if (data.hasFooter === true && data.footerLinkCount !== undefined && data.footerLinkCount <= 1) {
    suggestions.push({
      priority: 'LOW',
      category: 'design',
      suggestion: `footer has ${data.footerLinkCount} link(s) — consider adding site map links, legal links, or contact info`,
    });
  }
  if (data.hasFooter === false) {
    suggestions.push({
      priority: 'LOW',
      category: 'design',
      suggestion: 'no <footer> element — add a footer with copyright, navigation, or contact info',
    });
  }

  // LOW: No navigation
  if (data.hasNav === false) {
    suggestions.push({
      priority: 'LOW',
      category: 'design',
      suggestion: 'no <nav> element — add a navigation region for site links',
    });
  }

  // LOW: Thin navigation
  if (data.hasNav === true && data.navLinkCount !== undefined && data.navLinkCount <= 1) {
    suggestions.push({
      priority: 'LOW',
      category: 'design',
      suggestion: `nav has only ${data.navLinkCount} link(s) — consider adding more navigation or removing the empty nav`,
    });
  }

  // LOW: No content below fold
  if (
    data.belowFoldElements !== undefined &&
    data.totalElements !== undefined &&
    data.totalElements > 5 &&
    data.belowFoldElements === 0
  ) {
    suggestions.push({
      priority: 'LOW',
      category: 'design',
      suggestion:
        'no content below the fold — consider adding more sections or content below the viewport',
    });
  }

  if (suggestions.length === 0) {
    return '## Suggestions: None\n';
  }

  // In compact mode, skip LOW items
  const visible = compact ? suggestions.filter((s) => s.priority !== 'LOW') : suggestions;

  if (visible.length === 0) {
    return '## Suggestions: None\n';
  }

  const lines: string[] = ['## Suggestions\n'];
  visible.forEach((s, i) => {
    lines.push(`${i + 1}. [${s.priority}] ${s.category}: ${s.suggestion}`);
  });
  lines.push('');

  return lines.join('\n');
}
