import type { Browser } from 'playwright';
import type { ContrastPairResult } from './contrast.js';
import type { SectionResult } from './sections.js';

export interface ScreenshotConfig {
  url: string;
  output: string;
  width: number;
  height: number;
  fullPage: boolean;
  selector?: string;
  selectorAll?: boolean;
  waitMs?: number;
  darkMode: boolean;
  meta?: boolean;
  annotate?: boolean;
  perf?: boolean;
  interact?: string;
  /**
   * --fragment: this is a rendered component/fragment preview (e.g. via --html), not a full
   * document — suppresses doc-level noise (missing <html lang>, missing <link rel="canonical">)
   * from a11y.ts / seo.ts's automatic issue lists. Explicit --check assertions (lang, canonical,
   * …) are opt-in and unaffected.
   */
  fragment?: boolean;
  a11y?: boolean;
  contrast?: boolean;
  network?: boolean;
  sections?: boolean;
  filmstrip?: number;
  filmstripScroll?: number;
  compact?: boolean;
  report?: boolean;
  check?: string;
  audit?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  domStats?: boolean;
  browser?: Browser;
  cookie?: string;
  /** --local-storage "k=v; k2=v2" — seeded via init script before page scripts run. */
  localStorage?: string;
  /** --dismiss-consent — click/hide cookie & consent banners after load. */
  dismissConsent?: boolean;
  storageState?: string;
  basicAuth?: string;
  cssVars?: boolean;
  fonts?: boolean;
  lighthouse?: boolean;
  links?: boolean;
  /** --links-allow "domain1,domain2" — hosts always bucketed unverifiable (suffix match), never broken. */
  linksAllow?: string;
  classAudit?: boolean;
  fontSources?: boolean;
  assetHashes?: boolean;
  seo?: boolean;
  schema?: boolean;
  pdf?: boolean;
  har?: boolean;
  coverage?: boolean;
  json?: boolean;
  maxHeight?: number;
  visibleOnly?: boolean;
  fold?: boolean;
  micro?: boolean;
  designSpec?: string;
  diffReport?: string;
  delta?: boolean;
  suggest?: boolean;
  layout?: boolean;
  history?: boolean;
  consistency?: boolean;
  bundles?: boolean;
  imageAudit?: boolean;
  compression?: boolean;
  thirdParty?: boolean;
  cacheAudit?: boolean;
  criticalPath?: boolean;
  resourceHints?: boolean;
  serverTiming?: boolean;
  imageOptimizer?: boolean;
  budget?: string;
  timeout?: number;
  inject?: string;
  responsiveCheck?: boolean;
  targetSize?: number;
  tailwind?: boolean;
  /** Max elements sampled by contrast checks (--contrast and contrast:aa/aaa). Default 150. */
  contrastLimit?: number;
  /** --limit: max offenders listed per analysis section (touch targets, uncompressed, no-cache, …). Default 10. */
  listLimit?: number;
  /** Also write the markdown sidecar when `json` is on (batch/fleet: .meta.json for CI + .meta.md for agents). */
  metaMd?: boolean;
  /** --brief: red-only output — suppress stderr warnings that the brief line already folds in (HTTP status). */
  brief?: boolean;
  /** --host-resolver domain:ip — forces a dedicated Chromium launch with --host-resolver-rules. */
  hostResolverRule?: string;
  /**
   * Optional discriminator saved alongside the --history filename (e.g. 'desktop'/'mobile').
   * Lets a caller running multiple viewports for one URL (e.g. --multi's desktop+mobile
   * Promise.all) keep both history entries distinct even if they land in the same millisecond.
   */
  historyLabel?: string;
  /**
   * Stabilize the page immediately before it's captured/analyzed: cap the wait for web
   * fonts to finish loading (FOUT) and freeze CSS animations/transitions, so a mid-flight
   * frame never poisons a screenshot, contrast sample, or saved baseline. Default true.
   * Automatically skipped when --filmstrip is requested, since filmstrips need real motion.
   */
  stabilize?: boolean;
  /**
   * Capture the PNG even when the requested flags would otherwise skip it (the
   * --report/--check/--audit "text-only" fast path). Set when the caller explicitly asked
   * for an output path (-o/--name/--suffix) alongside a text-only mode — an explicit
   * output request shouldn't be silently dropped just because --report also ran.
   */
  forceScreenshot?: boolean;
}

export interface ScreenshotResult {
  imagePath: string;
  /** Source URL captured (set from config.url), used for batch/fleet output instead of the PNG path. */
  url?: string;
  /** True once a PNG/JPEG was actually written to imagePath (false in --report/--check/--audit text-only mode, unless forceScreenshot). */
  imageSaved?: boolean;
  metaPath?: string;
  legend?: string[];
  sectionResults?: SectionResult[];
  filmstripPath?: string;
  reportText?: string;
  checkResults?: string;
  /** Per-assertion --check results (structured twin of checkResults). */
  checkResultsData?: import('./check.js').CheckResult[];
  auditResults?: string;
  jsonData?: Record<string, any>;
  pageInfo?: {
    width: number;
    height: number;
    title: string;
    /** Viewport width used — lets output flag `width > viewportWidth` (horizontal scroll). */
    viewportWidth?: number;
    /** Top-3 elements/text causing the horizontal overflow (only set when width > viewportWidth). */
    overflowCulprits?: import('./responsive-check.js').OverflowCulprit[];
  };
  /** Path of the .meta.json sidecar when both formats were written (see metaMd). */
  jsonPath?: string;
  /** HTTP status of the main document when it was an error (>= 400). */
  httpStatus?: number;
  /** True when navigation's networkidle wait hit the NETWORK_IDLE_TIMEOUT_MS cap (navigate.ts)
   *  — a third-party embed (chat widget, ads, analytics beacon) kept the network busy forever,
   *  so looksy proceeded via domcontentloaded instead of waiting out the full --timeout.
   *  Surfaced on stdout as `(timed out waiting for network idle)`. */
  networkIdleTimeout?: boolean;
  /** What --dismiss-consent did ('clicked'/'hidden'/'none') plus target, for the stdout note. */
  consentDismissed?: { action: 'clicked' | 'hidden' | 'none'; target?: string };
  /** Whether a fresh browser was launched (vs reusing persistent server) */
  ownedBrowser?: boolean;
  /** Total elapsed time in ms */
  elapsedMs?: number;
  /** Contrast failure counts (for --fail-on-aa/--fail-on-aaa) */
  contrastFailures?: { aa: number; aaa: number; invisible?: number };
  /** Contrast pair details (for stdout output with --fail-on-aa) */
  contrastPairs?: ContrastPairResult[];
  /** Design spec validation text */
  designSpecResults?: string;
  /** Semantic diff report text */
  diffReportText?: string;
  /** Paths for --selector --all multi-element screenshots */
  selectorAllPaths?: string[];
  /** Delta comparison text */
  deltaText?: string;
  /** Actionable fix suggestions text */
  suggestText?: string;
  /** Layout overlay legend */
  layoutLegend?: string[];
  /** History save path */
  historyPath?: string;
  /** Budget check results */
  budgetResults?: import('./budget.js').BudgetData;
  /** Budget text output */
  budgetText?: string;
  /** Page snapshot for cross-page consistency (avoids revisiting) */
  pageSnapshot?: import('./consistency.js').PageSnapshot;
  /** Responsive check results */
  responsiveCheckResult?: import('./responsive-check.js').ResponsiveCheckResult;
  /** Responsive check formatted text */
  responsiveCheckText?: string;
  /** One-line per-analyzer summaries echoed to stdout (CI/agent-friendly) */
  analysisSummaries?: string[];
}

/** Run an async analysis function, catching errors into consoleErrors. */
export async function safeRun<T>(
  fn: () => Promise<T>,
  errors: string[],
  label: string,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: any) {
    errors.push(`${label} failed: ${err.message}`);
    return undefined;
  }
}
