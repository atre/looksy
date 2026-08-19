import type { Page } from 'playwright';

export interface PageSnapshot {
  url: string;
  title: string;
  headings: { level: number; text: string }[];
  colors: string[];
  fonts: string[];
  navLinks: string[];
  footerText: string;
}

/**
 * Extract a lightweight structural snapshot from a page for cross-page consistency comparison.
 */
export async function extractPageSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const title = document.title;

    // Headings
    const headings: { level: number; text: string }[] = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      headings.push({ level: parseInt(el.tagName[1]), text: (el.textContent || '').trim().slice(0, 60) });
    }

    // Color palette (bg + fg)
    const colorSet = new Set<string>();
    for (const el of document.querySelectorAll('body,header,footer,main,section,nav,h1,h2,h3,p,a,button')) {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colorSet.add(bg);
      const fg = cs.color;
      if (fg) colorSet.add(fg);
    }

    // Font stack
    const fontSet = new Set<string>();
    for (const el of document.querySelectorAll('body,h1,h2,h3,p,a,button')) {
      const ff = getComputedStyle(el).fontFamily;
      if (ff) fontSet.add(ff.split(',')[0].trim().replace(/['"]/g, ''));
    }

    // Nav links
    const navLinks: string[] = [];
    const nav = document.querySelector('nav');
    if (nav) {
      for (const a of nav.querySelectorAll('a[href]')) {
        navLinks.push((a.textContent || '').trim().slice(0, 40));
      }
    }

    // Footer text (first 200 chars)
    const footer = document.querySelector('footer');
    const footerText = footer ? (footer.textContent || '').trim().slice(0, 200) : '';

    return {
      url: location.href,
      title,
      headings,
      colors: Array.from(colorSet),
      fonts: Array.from(fontSet),
      navLinks,
      footerText,
    };
  });
}

/**
 * Compare multiple page snapshots and flag divergences.
 */
export function compareSnapshots(snapshots: PageSnapshot[], opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? false;
  const lines: string[] = [];
  lines.push(compact ? '## Consistency' : '## Cross-Page Consistency\n');

  if (snapshots.length < 2) {
    lines.push('Need at least 2 pages to compare.');
    lines.push('');
    return lines.join('\n');
  }

  let divergences = 0;

  // Heading structure comparison (level patterns)
  const headingPatterns = snapshots.map((s) => s.headings.map((h) => `H${h.level}`).join(','));
  const uniquePatterns = new Set(headingPatterns);
  if (uniquePatterns.size > 1) {
    divergences++;
    if (compact) {
      lines.push(`- Heading structure differs across pages`);
    } else {
      lines.push('### Heading Structure Divergence\n');
      for (let i = 0; i < snapshots.length; i++) {
        lines.push(`- **${snapshots[i].url}**: ${headingPatterns[i] || '(none)'}`);
      }
      lines.push('');
    }
  }

  // Color palette comparison
  const allColors = new Set<string>();
  for (const s of snapshots) s.colors.forEach((c) => allColors.add(c));
  const colorSets = snapshots.map((s) => new Set(s.colors));
  const sharedColors = [...allColors].filter((c) => colorSets.every((cs) => cs.has(c)));
  const sharedColorSet = new Set(sharedColors);
  const uniqueColors: { url: string; colors: string[] }[] = [];
  for (const s of snapshots) {
    const unique = s.colors.filter((c) => !sharedColorSet.has(c));
    if (unique.length > 0) uniqueColors.push({ url: s.url, colors: unique });
  }
  if (uniqueColors.length > 0) {
    divergences++;
    if (compact) {
      lines.push(`- Color palette: ${uniqueColors.length} page(s) have unique colors`);
    } else {
      lines.push('### Color Palette Divergence\n');
      lines.push(`Shared: ${sharedColors.length} colors | Divergent: ${uniqueColors.length} page(s)`);
      for (const u of uniqueColors) {
        lines.push(`- **${u.url}**: ${u.colors.slice(0, 5).join(', ')}${u.colors.length > 5 ? ` +${u.colors.length - 5} more` : ''}`);
      }
      lines.push('');
    }
  }

  // Font stack comparison
  const allFonts = new Set<string>();
  for (const s of snapshots) s.fonts.forEach((f) => allFonts.add(f));
  const fontSets = snapshots.map((s) => new Set(s.fonts));
  const sharedFonts = [...allFonts].filter((f) => fontSets.every((fs) => fs.has(f)));
  const sharedFontSet = new Set(sharedFonts);
  const uniqueFonts: { url: string; fonts: string[] }[] = [];
  for (const s of snapshots) {
    const unique = s.fonts.filter((f) => !sharedFontSet.has(f));
    if (unique.length > 0) uniqueFonts.push({ url: s.url, fonts: unique });
  }
  if (uniqueFonts.length > 0) {
    divergences++;
    if (compact) {
      lines.push(`- Font stack: ${uniqueFonts.length} page(s) have unique fonts`);
    } else {
      lines.push('### Font Stack Divergence\n');
      lines.push(`Shared: ${sharedFonts.join(', ')} | Divergent:`);
      for (const u of uniqueFonts) {
        lines.push(`- **${u.url}**: ${u.fonts.join(', ')}`);
      }
      lines.push('');
    }
  }

  // Nav comparison
  const navPatterns = snapshots.map((s) => s.navLinks.join(' | '));
  const uniqueNavs = new Set(navPatterns);
  if (uniqueNavs.size > 1) {
    divergences++;
    if (compact) {
      lines.push(`- Navigation differs across pages`);
    } else {
      lines.push('### Navigation Divergence\n');
      for (let i = 0; i < snapshots.length; i++) {
        lines.push(`- **${snapshots[i].url}**: ${navPatterns[i] || '(no nav)'}`);
      }
      lines.push('');
    }
  }

  // Footer comparison
  const footerTexts = snapshots.map((s) => s.footerText.slice(0, 100));
  const uniqueFooters = new Set(footerTexts);
  if (uniqueFooters.size > 1) {
    divergences++;
    if (compact) {
      lines.push(`- Footer content differs across pages`);
    } else {
      lines.push('### Footer Divergence\n');
      for (let i = 0; i < snapshots.length; i++) {
        lines.push(`- **${snapshots[i].url}**: "${footerTexts[i].slice(0, 60)}..."`);
      }
      lines.push('');
    }
  }

  if (divergences === 0) {
    lines.push(compact ? 'All pages consistent.' : 'All pages share the same heading structure, colors, fonts, navigation, and footer.\n');
  } else {
    lines.push(compact ? `${divergences} divergence(s) found.` : `**${divergences} divergence(s) found** across ${snapshots.length} pages.\n`);
  }
  lines.push('');

  return lines.join('\n');
}
