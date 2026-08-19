/**
 * Batch report generator for --pages + --batch-report.
 * Produces a single consolidated markdown table across all pages in a batch run.
 */

export interface BatchReportRow {
  url: string;
  /** AA contrast pass/fail — undefined if contrast not checked */
  contrastAa?: boolean;
  /** Number of AA contrast failures — undefined if not checked */
  contrastAaFails?: number;
  /** Number of SEO issues — undefined if SEO not checked */
  seoIssues?: number;
  /** Whether hreflang is present — undefined if SEO not checked */
  hreflang?: boolean;
  /** Primary schema.org type — undefined if schema not checked */
  schemaType?: string;
  /** meta[name="generator"] value — undefined if SEO not checked */
  generator?: string | null;
  /** Font source status — undefined if font-sources not checked */
  fontStatus?: 'self-hosted' | 'external' | 'none';
  /** External font domain(s) if any */
  externalFontDomains?: string[];
  /** Core Web Vitals summary (FCP, LCP) — undefined if perf not checked */
  cwvSummary?: string;
  /** Check results summary — undefined if checks not run */
  checkSummary?: string;
  /** Whether all --check assertions passed — undefined if checks not run */
  checkPassed?: boolean;
  /** Touch target failures (non-exempt) — undefined if responsive check not run */
  touchTargetFails?: number;
  /** Whether horizontal overflow was detected — undefined if responsive check not run */
  hasOverflow?: boolean;
}

/**
 * Extract batch report data from a ScreenshotResult's jsonData.
 * Only populates columns for analysis that was actually run.
 */
export function extractBatchRow(url: string, result: import('./screenshot.js').ScreenshotResult): BatchReportRow {
  const row: BatchReportRow = { url };
  const data = result.jsonData ?? {};

  // Contrast
  if (result.contrastFailures !== undefined) {
    row.contrastAa = result.contrastFailures.aa === 0;
    row.contrastAaFails = result.contrastFailures.aa;
  }

  // SEO (jsonData.seo is the SeoData object)
  if (data.seo) {
    const seo = data.seo;
    const issues: string[] = [];
    if (!seo.canonical) issues.push('no-canonical');
    if (!seo.og?.title) issues.push('no-og-title');
    if (!seo.description) issues.push('no-description');
    if (seo.generator) issues.push('generator');
    row.seoIssues = issues.length;
    row.hreflang = Array.isArray(seo.hreflang) && seo.hreflang.length > 0;
    row.generator = seo.generator ?? null;
  }

  // Schema (jsonData.schema is the SchemaData object)
  if (data.schema) {
    const schema = data.schema;
    const types: string[] = schema.types ?? schema.schemaTypes ?? [];
    row.schemaType = types.length > 0 ? types[0] : '—';
  }

  // Font sources (jsonData.fontSources is FontSourcesData)
  if (data.fontSources) {
    const fs = data.fontSources;
    if (!fs.sources || fs.sources.length === 0) {
      row.fontStatus = 'none';
    } else if (fs.externalDomains && fs.externalDomains.length > 0) {
      row.fontStatus = 'external';
      row.externalFontDomains = fs.externalDomains;
    } else {
      row.fontStatus = 'self-hosted';
    }
  }

  // Perf / CWV (jsonData.perf)
  if (data.perf) {
    const perf = data.perf;
    const parts: string[] = [];
    if (perf.fcp !== undefined) parts.push(`FCP ${perf.fcp}`);
    if (perf.lcp !== undefined) parts.push(`LCP ${perf.lcp}`);
    if (parts.length > 0) row.cwvSummary = parts.join(', ');
  }

  // Check results — structured when available, else parsed from the text block
  if (result.checkResultsData !== undefined || result.checkResults !== undefined) {
    const text = result.checkResults ?? '';
    const failCount = result.checkResultsData
      ? result.checkResultsData.filter((r) => !r.pass).length
      : (text.match(/\[FAIL\]/g) || []).length;
    const passCount = result.checkResultsData
      ? result.checkResultsData.filter((r) => r.pass).length
      : (text.match(/\[PASS\]/g) || []).length;
    const total = failCount + passCount;
    if (failCount === 0 && total > 0) {
      row.checkSummary = `${total}/${total} PASS`;
      row.checkPassed = true;
    } else if (total > 0) {
      row.checkSummary = `${passCount}/${total} PASS`;
      row.checkPassed = false;
    }
  }

  // Responsive check (jsonData.responsiveCheck is ResponsiveCheckResult)
  if (data.responsiveCheck) {
    const rc = data.responsiveCheck;
    const allTargets = rc.breakpoints?.reduce((sum: number, bp: any) => {
      const nonExempt = (bp.touchTargetDetails || []).filter((t: any) => !t.inlineExempt);
      return sum + nonExempt.length;
    }, 0) ?? 0;
    row.touchTargetFails = allTargets;
    row.hasOverflow = rc.breakpoints?.some((bp: any) => bp.hasHorizontalOverflow) ?? false;
  }

  return row;
}

/**
 * Render an array of BatchReportRows into a markdown table.
 * Only includes columns for data that was actually collected (at least one row has the value).
 */
export function formatBatchReport(rows: BatchReportRow[], opts: { baseUrl?: string } = {}): string {
  if (rows.length === 0) return '## Batch Report\n\nNo pages captured.\n';

  // Determine which columns are populated
  const hasContrast = rows.some((r) => r.contrastAa !== undefined);
  const hasSeoIssues = rows.some((r) => r.seoIssues !== undefined);
  const hasHreflang = rows.some((r) => r.hreflang !== undefined);
  const hasSchema = rows.some((r) => r.schemaType !== undefined);
  const hasGenerator = rows.some((r) => r.generator !== undefined);
  const hasFonts = rows.some((r) => r.fontStatus !== undefined);
  const hasCwv = rows.some((r) => r.cwvSummary !== undefined);
  const hasChecks = rows.some((r) => r.checkSummary !== undefined);
  const hasResponsive = rows.some((r) => r.touchTargetFails !== undefined);

  // Build header
  const headers: string[] = ['URL'];
  if (hasContrast) headers.push('Contrast AA');
  if (hasResponsive) headers.push('Touch Targets');
  if (hasResponsive) headers.push('Overflow');
  if (hasSeoIssues) headers.push('SEO Issues');
  if (hasHreflang) headers.push('hreflang');
  if (hasSchema) headers.push('Schema');
  if (hasGenerator) headers.push('Generator');
  if (hasFonts) headers.push('Font Source');
  if (hasCwv) headers.push('CWV');
  if (hasChecks) headers.push('Checks');

  const sep = headers.map(() => '---');

  // Build rows
  const tableRows = rows.map((r) => {
    // Shorten URL for display
    let displayUrl = r.url;
    if (opts.baseUrl) {
      try {
        const base = new URL(opts.baseUrl);
        const full = new URL(r.url);
        if (full.hostname === base.hostname) {
          displayUrl = full.pathname + (full.search || '');
        }
      } catch { /* keep full url */ }
    }

    const cols: string[] = [displayUrl];
    if (hasContrast) {
      if (r.contrastAa === undefined) {
        cols.push('—');
      } else {
        cols.push(r.contrastAa ? `PASS` : `FAIL (${r.contrastAaFails})`);
      }
    }
    if (hasResponsive) {
      if (r.touchTargetFails === undefined) cols.push('—');
      else cols.push(r.touchTargetFails === 0 ? 'PASS' : `FAIL (${r.touchTargetFails})`);
    }
    if (hasResponsive) {
      if (r.hasOverflow === undefined) cols.push('—');
      else cols.push(r.hasOverflow ? 'YES' : 'no');
    }
    if (hasSeoIssues) cols.push(r.seoIssues !== undefined ? String(r.seoIssues) : '—');
    if (hasHreflang) cols.push(r.hreflang !== undefined ? (r.hreflang ? 'yes' : 'no') : '—');
    if (hasSchema) cols.push(r.schemaType ?? '—');
    if (hasGenerator) {
      if (r.generator === undefined) cols.push('—');
      else if (r.generator === null) cols.push('none');
      else cols.push(`⚠ ${r.generator}`);
    }
    if (hasFonts) {
      if (r.fontStatus === undefined) cols.push('—');
      else if (r.fontStatus === 'self-hosted') cols.push('self-hosted');
      else if (r.fontStatus === 'none') cols.push('none detected');
      else cols.push(`external: ${(r.externalFontDomains || []).join(', ')}`);
    }
    if (hasCwv) cols.push(r.cwvSummary ?? '—');
    if (hasChecks) {
      if (r.checkSummary === undefined) cols.push('—');
      else cols.push(r.checkPassed ? `✓ ${r.checkSummary}` : `✗ ${r.checkSummary}`);
    }
    return cols;
  });

  const lines: string[] = ['## Batch Report\n'];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${sep.join(' | ')} |`);
  for (const row of tableRows) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');

  // Summary stats
  const total = rows.length;
  const summaryParts: string[] = [`${total} page(s)`];
  if (hasContrast) {
    const aaFail = rows.filter((r) => r.contrastAa === false).length;
    summaryParts.push(`${total - aaFail}/${total} contrast AA pass`);
  }
  if (hasResponsive) {
    const touchFail = rows.filter((r) => r.touchTargetFails !== undefined && r.touchTargetFails > 0).length;
    if (touchFail > 0) summaryParts.push(`${touchFail} page(s) with touch target issues`);
    else summaryParts.push('all touch targets pass');
    const overflowCount = rows.filter((r) => r.hasOverflow === true).length;
    if (overflowCount > 0) summaryParts.push(`${overflowCount} page(s) with overflow`);
  }
  if (hasChecks) {
    const checkFail = rows.filter((r) => r.checkPassed === false).length;
    summaryParts.push(`${total - checkFail}/${total} checks pass`);
  }
  if (hasFonts) {
    const extFonts = rows.filter((r) => r.fontStatus === 'external').length;
    if (extFonts > 0) summaryParts.push(`${extFonts} page(s) with external fonts`);
    else summaryParts.push('all fonts self-hosted');
  }
  lines.push(`**Summary:** ${summaryParts.join(' | ')}\n`);

  return lines.join('\n');
}
