import type { ScreenshotResult } from './screenshot.js';
import type { CheckResult } from './check.js';
import { formatIdleTimeoutNote } from './navigate.js';

/** Check contrast results: print failing elements to stderr and exit with code 1 if triggered */
export function checkContrastExit(
  results: ScreenshotResult[],
  failAa: boolean,
  failAaa: boolean,
): void {
  let shouldExit = false;
  for (const r of results) {
    if (!r.contrastFailures) continue;
    if (failAa && r.contrastFailures.aa > 0) shouldExit = true;
    if (failAaa && r.contrastFailures.aaa > 0) shouldExit = true;
  }
  if (!shouldExit) return;

  // Print failing element details to stderr before exiting
  for (const r of results) {
    if (!r.contrastPairs) continue;
    const aaFails = r.contrastPairs.filter((p) => !p.aaPass);
    if (aaFails.length === 0) continue;
    console.error(`\nContrast failures${results.length > 1 ? ` (${r.url ?? r.imagePath})` : ''}:`);
    for (const f of aaFails) {
      const cls = f.className ? ` [${f.className.split(/\s+/).slice(0, 2).join(' ')}]` : '';
      console.error(
        `  ${f.tag} "${f.text}" — ${f.ratio.toFixed(1)}:1 (${f.color} on ${f.bg})${cls}`,
      );
    }
  }
  process.exit(1);
}

/** A failed `--check` assertion is a gate failure: exit 1 (deferred, so cleanup still runs). */
export function flagFailedChecks(results: ScreenshotResult[]): void {
  if (results.some((r) => r.checkResultsData?.some((c) => !c.pass))) process.exitCode = 1;
}

export interface PrintOptions {
  /**
   * --quiet: suppress output-path lines; keep the Page line, analyzer summaries, checks and
   * suggestions. When checks ran (result.checkResults is set), quiet goes further: only the
   * Page/consent/check lines print — report, responsive, suggest and audit bodies are dropped.
   */
  quiet?: boolean;
}

/** ` ⚠ hscroll +Npx wider than Wpx viewport` when the page overflows the viewport, else ''. */
export function formatOverflowFlag(pageWidth: number, viewportWidth: number): string {
  const frag = hscrollFragment({
    pageInfo: { width: pageWidth, height: 0, title: '', viewportWidth },
  });
  return frag ? ` ⚠ ${frag} wider than ${viewportWidth}px viewport` : '';
}

/** "Page: WxHpx" line with an explicit horizontal-overflow flag when the document is wider than the viewport. */
export function formatPageLine(result: ScreenshotResult): string | undefined {
  if (!result.pageInfo) return undefined;
  const { width, height, title, viewportWidth } = result.pageInfo;
  const timing = result.elapsedMs ? ` (${(result.elapsedMs / 1000).toFixed(1)}s)` : '';
  // The width alone already carries the signal (396px at --width 375 = 21px of horizontal
  // scroll) but nobody notices unless they compare it to the flag they passed — say it.
  const over = viewportWidth ? formatOverflowFlag(width, viewportWidth) : '';
  return `Page: ${width}x${height}px${over}${title ? ` "${title}"` : ''}${timing}`;
}

export function printResult(result: ScreenshotResult, opts: PrintOptions = {}): void {
  const quiet = opts.quiet ?? false;
  // -q + --check: checks were run, so print only the Page/consent/check signal —
  // suppress the report/responsive/suggest/audit/analyzer-summary bodies.
  const checksOnly = quiet && !!result.checkResults;
  const pageLine = formatPageLine(result);
  if (pageLine) console.log(pageLine);
  if (result.pageInfo?.overflowCulprits) {
    for (const c of result.pageInfo.overflowCulprits) {
      console.log(`  overflow: ${c.tag} right=${c.right}px "${c.text}"`);
    }
  }
  if (result.networkIdleTimeout) console.log(formatIdleTimeoutNote());
  if (result.consentDismissed) {
    console.log(
      result.consentDismissed.action === 'none'
        ? 'consent: not shown'
        : `consent: ${result.consentDismissed.action} ${result.consentDismissed.target ?? ''}`.trim(),
    );
  }
  // Suggest --serve when a fresh browser launch took >1s
  if (!quiet && result.ownedBrowser && result.elapsedMs && result.elapsedMs > 1000) {
    console.error('Tip: looksy --serve keeps Chromium hot (~100ms instead of ~2s)');
  }
  if (result.metaPath && !quiet) console.log(result.metaPath);
  if (result.jsonPath && !quiet) console.log(result.jsonPath);
  // One-line analyzer summaries for shell/CI/agent use (full detail lives in the sidecar)
  if (result.analysisSummaries && !checksOnly) {
    for (const s of result.analysisSummaries) console.log(s);
  }
  // Only print image path if a PNG was actually created
  if (
    !quiet &&
    (!result.metaPath ||
      result.legend ||
      result.sectionResults ||
      result.filmstripPath ||
      result.imageSaved)
  ) {
    console.log(result.imagePath);
  }
  if (result.filmstripPath) console.log(result.filmstripPath);
  if (result.legend) result.legend.forEach((l) => console.log(l));
  if (result.sectionResults) {
    for (const s of result.sectionResults) {
      console.log(`  section ${s.index}: ${s.path}`);
    }
  }
  // Text results also live in .meta.md for AI consumption
  if (result.reportText && !checksOnly) console.log(result.reportText);
  if (result.checkResults) console.log(result.checkResults);
  // Responsive findings (touch targets, overflow) used to land only in the sidecar even though
  // --design-audit advertises them — the most actionable audit output belongs on stdout.
  if (result.responsiveCheckText && !checksOnly) console.log(result.responsiveCheckText);
  if (result.auditResults && !checksOnly) console.log(result.auditResults);
  if (result.designSpecResults) console.log(result.designSpecResults);
  if (result.diffReportText) console.log(result.diffReportText);
  if (result.deltaText) console.log(result.deltaText);
  if (result.suggestText && !checksOnly) console.log(result.suggestText);
  if (result.budgetText) console.log(result.budgetText);
  if (result.layoutLegend) result.layoutLegend.forEach((l) => console.log(l));
  if (result.historyPath) console.log(`  history: ${result.historyPath}`);
  if (result.selectorAllPaths) {
    for (const p of result.selectorAllPaths) console.log(`  element: ${p}`);
  }
}

/** Minimal result shape --brief/findings care about — a subset of ScreenshotResult so both
 * real captures and lightweight test fixtures (missing most fields) satisfy it. */
export interface BriefResult {
  pageInfo?: { width: number; height: number; title: string; viewportWidth?: number };
  contrastFailures?: { aa: number; aaa: number; invisible?: number };
  checkResultsData?: CheckResult[];
  /** Set for a batch/fleet target whose capture failed outright (no result to inspect). */
  error?: string;
  /** Main-document HTTP status when it was an error (>= 400). */
  httpStatus?: number;
}

/** `HTTP 404` when the main document came back with an error status, else undefined. */
export function httpStatusFragment(result: BriefResult): string | undefined {
  return result.httpStatus !== undefined && result.httpStatus >= 400
    ? `HTTP ${result.httpStatus}`
    : undefined;
}

/** `hscroll +Npx` when the page overflows the viewport, else undefined. */
export function hscrollFragment(result: BriefResult): string | undefined {
  const p = result.pageInfo;
  if (!p?.viewportWidth || p.width <= p.viewportWidth) return undefined;
  return `hscroll +${p.width - p.viewportWidth}px`;
}

/** `N AA fail` when contrast AA failures were recorded, else undefined. */
export function aaFailFragment(result: BriefResult): string | undefined {
  const aa = result.contrastFailures?.aa ?? 0;
  return aa > 0 ? `${aa} AA fail` : undefined;
}

/** `N invisible` when contrast ratio < 1.5:1 pairs were recorded, else undefined. Always red —
 * invisible text is worse than an ordinary AA fail, so it's counted separately and leads. */
export function invisibleFragment(result: BriefResult): string | undefined {
  const n = result.contrastFailures?.invisible ?? 0;
  return n > 0 ? `${n} invisible` : undefined;
}

/** `N check fail` when any --check assertion failed, else undefined. */
export function checkFailFragment(result: BriefResult): string | undefined {
  const n = (result.checkResultsData ?? []).filter((c) => !c.pass).length;
  return n > 0 ? `${n} check fail` : undefined;
}

function redFragments(result: BriefResult): string[] {
  return [
    httpStatusFragment(result),
    hscrollFragment(result),
    invisibleFragment(result),
    aaFailFragment(result),
    checkFailFragment(result),
    result.error,
  ].filter((f): f is string => Boolean(f));
}

/**
 * Shared "red" definition for `--brief` and `--fail-only`: true when any of HTTP status,
 * hscroll, AA contrast fails, `--check` fails, or an outright capture error is present.
 */
export function isRed(result: BriefResult): boolean {
  return redFragments(result).length > 0;
}

/**
 * `--brief`: ≤10 lines, red only — for gate/hook use. One `✗ <url> — <fragments>` line per red
 * URL, nothing for clean ones; `✓ N URL(s) clean` when nothing is red at all. Over 10 red lines,
 * the first 9 print and the rest collapse into ` … and K more`.
 */
export function briefIsRed(entries: Array<{ url: string; result: BriefResult }>): boolean {
  return entries.some(({ result }) => isRed(result));
}

export function formatBrief(entries: Array<{ url: string; result: BriefResult }>): string[] {
  const red = entries
    .map(({ url, result }) => {
      const frags = redFragments(result);
      return frags.length > 0 ? `✗ ${url} — ${frags.join(', ')}` : undefined;
    })
    .filter((l): l is string => Boolean(l));
  if (red.length === 0)
    return [`✓ ${entries.length} ${entries.length === 1 ? 'URL' : 'URLs'} clean`];
  if (red.length <= 10) return red;
  return [...red.slice(0, 9), ` … and ${red.length - 9} more`];
}
