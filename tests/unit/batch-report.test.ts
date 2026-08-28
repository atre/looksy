import { describe, it, expect } from 'vitest';
import { extractBatchRow, formatBatchReport, type BatchReportRow } from '../../dist/batch-report.js';
import type { ScreenshotResult } from '../../dist/screenshot.js';

function makeResult(overrides: Partial<ScreenshotResult> = {}): ScreenshotResult {
  return {
    imagePath: '/tmp/looksy/preview.png',
    pageInfo: { width: 1280, height: 800, title: 'Test Page' },
    ...overrides,
  };
}

describe('extractBatchRow', () => {
  it('extracts URL correctly', () => {
    const row = extractBatchRow('https://example.com/', makeResult());
    expect(row.url).toBe('https://example.com/');
  });

  it('extracts contrast data when contrastFailures is present', () => {
    const result = makeResult({ contrastFailures: { aa: 0, aaa: 2 } });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.contrastAa).toBe(true); // 0 AA failures = pass
    expect(row.contrastAaFails).toBe(0);
  });

  it('marks contrast as failed when AA failures > 0', () => {
    const result = makeResult({ contrastFailures: { aa: 3, aaa: 5 } });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.contrastAa).toBe(false);
    expect(row.contrastAaFails).toBe(3);
  });

  it('leaves contrast undefined when not checked', () => {
    const row = extractBatchRow('https://example.com/', makeResult());
    expect(row.contrastAa).toBeUndefined();
  });

  it('extracts SEO data from jsonData.seo', () => {
    const result = makeResult({
      jsonData: {
        seo: {
          title: 'Test',
          description: 'desc',
          canonical: 'https://example.com/',
          generator: null,
          og: { 'og:title': 'Test' },
          hreflang: [{ lang: 'en', href: 'https://example.com/' }, { lang: 'de', href: 'https://example.com/de/' }],
        },
      },
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.seoIssues).toBeDefined();
    expect(row.hreflang).toBe(true);
    expect(row.generator).toBeNull(); // null = no generator tag
  });

  it('counts SEO issues correctly', () => {
    const result = makeResult({
      jsonData: {
        seo: {
          title: 'Test',
          description: null, // missing — counts as issue
          canonical: null,   // missing — counts as issue
          generator: 'Astro 4.0', // present — counts as issue
          og: {},
          hreflang: [],
        },
      },
    });
    const row = extractBatchRow('https://example.com/', result);
    // no-canonical + no-og-title + no-description + generator = 4 issues
    expect(row.seoIssues).toBe(4);
  });

  it('extracts schema type from jsonData.schema', () => {
    const result = makeResult({
      jsonData: {
        schema: { types: ['Article', 'BreadcrumbList'] },
      },
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.schemaType).toBe('Article');
  });

  it('handles empty schema types', () => {
    const result = makeResult({
      jsonData: { schema: { types: [] } },
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.schemaType).toBe('—');
  });

  it('extracts font status as self-hosted', () => {
    const result = makeResult({
      jsonData: {
        fontSources: {
          sources: [{ url: '/fonts/inter.woff2', family: 'Inter', format: 'woff2', external: false }],
          externalDomains: [],
        },
      },
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.fontStatus).toBe('self-hosted');
  });

  it('extracts font status as external when Google Fonts present', () => {
    const result = makeResult({
      jsonData: {
        fontSources: {
          sources: [{ url: 'https://fonts.googleapis.com/css2?family=Inter', family: '', format: 'stylesheet', external: true }],
          externalDomains: ['fonts.googleapis.com'],
        },
      },
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.fontStatus).toBe('external');
    expect(row.externalFontDomains).toContain('fonts.googleapis.com');
  });

  it('extracts font status as none when no fonts detected', () => {
    const result = makeResult({
      jsonData: { fontSources: { sources: [], externalDomains: [] } },
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.fontStatus).toBe('none');
  });

  it('leaves fontStatus undefined when fontSources not checked', () => {
    const row = extractBatchRow('https://example.com/', makeResult());
    expect(row.fontStatus).toBeUndefined();
  });

  it('extracts check summary from PASS checkResults', () => {
    const result = makeResult({
      checkResults: '## Check Results\n\n- [PASS] no generator — no generator found\n- [PASS] self-hosted-fonts — all 3 font(s) self-hosted\n\nAll checks passed.\n',
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.checkPassed).toBe(true);
    expect(row.checkSummary).toBe('2/2 PASS');
  });

  it('extracts check summary from FAIL checkResults', () => {
    const result = makeResult({
      checkResults: '## Check Results\n\n- [PASS] no generator — no generator found\n- [FAIL] self-hosted-fonts — external font domain(s) found: fonts.googleapis.com\n\nSome checks failed.\n',
    });
    const row = extractBatchRow('https://example.com/', result);
    expect(row.checkPassed).toBe(false);
    expect(row.checkSummary).toBe('1/2 PASS');
  });

  it('leaves check fields undefined when checks not run', () => {
    const row = extractBatchRow('https://example.com/', makeResult());
    expect(row.checkPassed).toBeUndefined();
    expect(row.checkSummary).toBeUndefined();
  });
});

describe('formatBatchReport', () => {
  it('returns a no-pages message for empty array', () => {
    const result = formatBatchReport([]);
    expect(result).toContain('No pages captured');
  });

  it('generates correct markdown table headers', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', contrastAa: true, contrastAaFails: 0 },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('| URL |');
    expect(result).toContain('Contrast AA');
  });

  it('only includes columns for analysis that was actually run', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/' }, // no analysis data
    ];
    const result = formatBatchReport(rows);
    // Only URL column since no other data
    expect(result).toContain('| URL |');
    expect(result).not.toContain('Contrast AA');
    expect(result).not.toContain('SEO Issues');
    expect(result).not.toContain('Font Source');
  });

  it('includes contrast column only when contrast data is present', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', contrastAa: true, contrastAaFails: 0 },
      { url: 'https://example.com/about', contrastAa: false, contrastAaFails: 2 },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('Contrast AA');
    expect(result).toContain('PASS');
    expect(result).toContain('FAIL (2)');
  });

  it('includes font source column when font data is present', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', fontStatus: 'self-hosted' },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('Font Source');
    expect(result).toContain('self-hosted');
  });

  it('shows external font domains in font column', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', fontStatus: 'external', externalFontDomains: ['fonts.googleapis.com'] },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('fonts.googleapis.com');
  });

  it('shortens URLs when baseUrl matches', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', contrastAa: true, contrastAaFails: 0 },
      { url: 'https://example.com/pricing', contrastAa: true, contrastAaFails: 0 },
    ];
    const result = formatBatchReport(rows, { baseUrl: 'https://example.com/' });
    // URLs should be shortened to paths
    expect(result).toContain('/pricing');
    // Should not have full URL repeated
  });

  it('includes summary line', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', contrastAa: true, contrastAaFails: 0 },
      { url: 'https://example.com/about', contrastAa: false, contrastAaFails: 3 },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('**Summary:**');
    expect(result).toContain('2 page(s)');
    expect(result).toContain('1/2 contrast AA pass');
  });

  it('handles missing data gracefully with — placeholder', () => {
    // One row has contrast, other doesn't — the one without should show "—"
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', contrastAa: true, contrastAaFails: 0 },
      { url: 'https://example.com/about' }, // no contrast data
    ];
    const result = formatBatchReport(rows);
    // Should include "—" for the missing row
    expect(result).toContain('—');
  });

  it('includes check column when check data is present', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', checkPassed: true, checkSummary: '3/3 PASS' },
      { url: 'https://example.com/about', checkPassed: false, checkSummary: '2/3 PASS' },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('Checks');
    expect(result).toContain('3/3 PASS');
    expect(result).toContain('2/3 PASS');
  });

  it('shows all-fonts-self-hosted in summary when all fonts are clean', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', fontStatus: 'self-hosted' },
      { url: 'https://example.com/about', fontStatus: 'self-hosted' },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('all fonts self-hosted');
  });

  it('shows external font count in summary when external fonts present', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', fontStatus: 'external', externalFontDomains: ['fonts.googleapis.com'] },
      { url: 'https://example.com/about', fontStatus: 'self-hosted' },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('1 page(s) with external fonts');
  });

  it('includes responsive columns when touch target data is present', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', touchTargetFails: 0, hasOverflow: false },
      { url: 'https://example.com/about', touchTargetFails: 5, hasOverflow: true },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('Touch Targets');
    expect(result).toContain('Overflow');
    expect(result).toContain('PASS');
    expect(result).toContain('FAIL (5)');
    expect(result).toContain('YES');
  });

  it('shows touch target summary in batch report', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', touchTargetFails: 3, hasOverflow: false },
      { url: 'https://example.com/about', touchTargetFails: 0, hasOverflow: false },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('1 page(s) with touch target issues');
  });

  it('shows all-touch-targets-pass in summary when none fail', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/', touchTargetFails: 0, hasOverflow: false },
      { url: 'https://example.com/about', touchTargetFails: 0, hasOverflow: false },
    ];
    const result = formatBatchReport(rows);
    expect(result).toContain('all touch targets pass');
  });

  it('does not include responsive columns when data is absent', () => {
    const rows: BatchReportRow[] = [
      { url: 'https://example.com/' },
    ];
    const result = formatBatchReport(rows);
    expect(result).not.toContain('Touch Targets');
    expect(result).not.toContain('Overflow');
  });
});
