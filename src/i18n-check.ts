import type { Page } from 'playwright';

export interface LocaleSnapshot {
  url: string;
  title: string;
  lang: string;
  headingCount: number;
  sectionCount: number;
  textLength: number;
  pageHeight: number;
  headings: string[];
}

/**
 * Extract structural snapshot for i18n comparison.
 */
export async function extractLocaleSnapshot(page: Page): Promise<LocaleSnapshot> {
  return page.evaluate(() => {
    const headings: string[] = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      headings.push((el.textContent || '').trim().slice(0, 80));
    }

    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.getAttribute('lang') || '',
      headingCount: headings.length,
      sectionCount: document.querySelectorAll('section, main, header, footer, nav, article, aside').length,
      textLength: (document.body.textContent || '').trim().length,
      pageHeight: document.documentElement.scrollHeight,
      headings,
    };
  });
}

/**
 * Compare two locale snapshots and report structural differences.
 */
export function compareLocales(a: LocaleSnapshot, b: LocaleSnapshot, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? false;
  const lines: string[] = [];
  lines.push(compact ? '## i18n Check' : '## i18n Structural Comparison\n');

  lines.push(compact
    ? `A: ${a.url} (${a.lang || '?'}) | B: ${b.url} (${b.lang || '?'})`
    : `- **A:** ${a.url} (lang="${a.lang || '?'}")\n- **B:** ${b.url} (lang="${b.lang || '?'}")\n`);

  const diffs: string[] = [];

  if (a.headingCount !== b.headingCount) {
    diffs.push(`Headings: ${a.headingCount} vs ${b.headingCount}`);
  }
  if (a.sectionCount !== b.sectionCount) {
    diffs.push(`Sections: ${a.sectionCount} vs ${b.sectionCount}`);
  }

  const textDelta = Math.abs(a.textLength - b.textLength);
  const textPercent = a.textLength > 0 ? ((textDelta / a.textLength) * 100).toFixed(0) : '?';
  if (textDelta > 100) {
    diffs.push(`Text length: ${a.textLength} vs ${b.textLength} (${textPercent}% delta)`);
  }

  const heightDelta = Math.abs(a.pageHeight - b.pageHeight);
  const heightPercent = a.pageHeight > 0 ? ((heightDelta / a.pageHeight) * 100).toFixed(0) : '?';
  if (heightDelta > 50) {
    diffs.push(`Page height: ${a.pageHeight}px vs ${b.pageHeight}px (${heightPercent}% delta)`);
  }

  if (diffs.length === 0) {
    lines.push(compact ? 'Structure matches.' : 'Structural layout is consistent between locales.\n');
  } else {
    for (const d of diffs) {
      lines.push(`- ${d}`);
    }
    if (!compact) lines.push('');
  }

  lines.push('');
  return lines.join('\n');
}
