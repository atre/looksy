import { screenshot, type ScreenshotConfig } from './screenshot.js';
import { saveBaseline, diffBaseline, listBaselines } from './diff.js';
import { viewports } from './viewports.js';
import { navigateSafe } from './navigate.js';
import { LOOKSY_DIR } from './utils.js';
import type { ContrastPairResult } from './contrast.js';
import type { ThemeValidationResult } from './validate-theme.js';
import type { DesignValidationResult } from './design-spec.js';
import type { SemanticSnapshot } from './diff-report.js';

/**
 * Uniform verdict schema for "judgment" tools (contrast/theme/design validation, diff/guard-style
 * comparisons, fingerprint similarity). Built directly from the same structured data the
 * human-readable text is formatted from — never by re-parsing our own prose.
 */
export type Severity = 'high' | 'medium' | 'low';

export interface VerdictIssue {
  severity: Severity;
  message: string;
  selector?: string;
  fix?: string;
}

export interface Verdict {
  pass: boolean;
  score?: number;
  summary: string;
  issues: VerdictIssue[];
}

// ---------- MCP result helpers ----------

/** Render a structured object as a fenced ```json content block — the compatible fallback
 * for MCP clients that don't read `structuredContent` (works on every protocol version). */
export function jsonBlock(data: Record<string, unknown>): { type: 'text'; text: string } {
  return { type: 'text', text: '```json\n' + JSON.stringify(data, null, 2) + '\n```' };
}

/** Append a structured JSON block to existing human-readable content, and also set
 * `structuredContent` (supported by @modelcontextprotocol/sdk ^1.27) for clients that prefer it. */
export function withStructured(content: any[], structured: Record<string, unknown>): any {
  return { content: [...content, jsonBlock(structured)], structuredContent: structured };
}

/** Per-tool error result: never let a tool failure crash the server. */
export function errorResult(err: any): any {
  const message = err?.message ?? String(err);
  const structured = { ok: false, error: message };
  return {
    content: [{ type: 'text', text: `Error: ${message}` }, jsonBlock(structured)],
    structuredContent: structured,
    isError: true,
  };
}

// ---------- Verdict builders (pure — unit-testable) ----------

/** Coarse severity bucket for a contrast ratio against a nominal 4.5:1 (WCAG AA normal-text)
 * reference. Used only to rank already-failing pairs; pass/fail itself always comes from the
 * underlying `aaPass`/`aaaPass` computed by contrast.ts (which correctly applies the large-text
 * exemption) — this never re-derives pass/fail from the ratio. */
export function contrastSeverity(ratio: number): Severity {
  if (ratio < 2.5) return 'high';
  if (ratio < 3.5) return 'medium';
  return 'low';
}

export function buildContrastVerdict(
  pairs: ContrastPairResult[],
  opts: { fixFor?: (p: ContrastPairResult) => string | undefined } = {},
): Verdict {
  const failures = pairs.filter((p) => !p.aaPass);
  const pass = failures.length === 0;
  const score =
    pairs.length > 0
      ? Math.round(((pairs.length - failures.length) / pairs.length) * 1000) / 10
      : 100;
  const issues: VerdictIssue[] = failures.map((p) => {
    const firstClass = p.className ? p.className.trim().split(/\s+/)[0] : '';
    const selector = firstClass ? `${p.tag}.${firstClass}` : p.tag;
    const issue: VerdictIssue = {
      severity: contrastSeverity(p.ratio),
      message: `${p.tag} "${p.text}" — ${p.ratio.toFixed(2)}:1 (${p.color} on ${p.bg}), need 4.5:1`,
      selector,
    };
    const fix = opts.fixFor?.(p);
    if (fix) issue.fix = fix;
    return issue;
  });
  const summary = pass
    ? `All ${pairs.length} sampled text elements pass WCAG AA`
    : `${failures.length}/${pairs.length} sampled text elements fail WCAG AA`;
  return { pass, score, summary, issues };
}

export function buildThemeVerdict(
  results: ThemeValidationResult[],
  opts: { fixFor?: (r: ThemeValidationResult) => string | undefined } = {},
): Verdict {
  const failures = results.filter((r) => !r.aaPass);
  const pass = failures.length === 0;
  const score =
    results.length > 0
      ? Math.round(((results.length - failures.length) / results.length) * 1000) / 10
      : 100;
  const issues: VerdictIssue[] = failures.map((r) => {
    const issue: VerdictIssue = {
      severity: contrastSeverity(r.ratio),
      message: `${r.label}: ${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}:1 (need 4.5:1)`,
    };
    const fix = opts.fixFor?.(r);
    if (fix) issue.fix = fix;
    return issue;
  });
  const summary = pass
    ? `All ${results.length} pairs pass WCAG AA`
    : `${failures.length}/${results.length} pairs fail WCAG AA`;
  return { pass, score, summary, issues };
}

export function buildDesignVerdict(results: DesignValidationResult[]): Verdict {
  const failures = results.filter((r) => !r.pass);
  const pass = failures.length === 0;
  const score =
    results.length > 0
      ? Math.round(((results.length - failures.length) / results.length) * 1000) / 10
      : 100;
  const issues: VerdictIssue[] = failures.map((r) => ({
    severity: r.category === 'spacing' ? 'low' : 'medium',
    message: `${r.selector} ${r.property}: got "${r.actual}", expected "${r.expected}"`,
    selector: r.selector,
  }));
  const summary = pass
    ? `All ${results.length} design spec checks pass`
    : `${failures.length}/${results.length} design spec checks failed`;
  return { pass, score, summary, issues };
}

/** Default visual-regression gate threshold (%), matching the `guard` subcommand's default. */
export const DEFAULT_DIFF_THRESHOLD = 0.5;

export function buildDiffVerdict(
  diff: { changedPixels: number; totalPixels: number; changePercent: string },
  threshold: number = DEFAULT_DIFF_THRESHOLD,
): Verdict {
  const pct = parseFloat(diff.changePercent);
  const pass = pct <= threshold;
  const severity: Severity = pct > threshold * 4 ? 'high' : pct > threshold * 2 ? 'medium' : 'low';
  const summary = pass
    ? `${diff.changePercent}% changed (within ${threshold}% threshold)`
    : `${diff.changePercent}% changed (exceeds ${threshold}% threshold)`;
  const issues: VerdictIssue[] = pass
    ? []
    : [
        {
          severity,
          message: `${diff.changedPixels}/${diff.totalPixels} pixels changed (${diff.changePercent}%)`,
        },
      ];
  return { pass, score: pct, summary, issues };
}

/** Cross-site fingerprint-similarity risk banding, matching fingerprint.ts's internal (unexported)
 * riskLevel() thresholds. */
export function riskLevelFor(score: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL' {
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'MINIMAL';
}

interface FingerprintPairLike {
  nameA: string;
  nameB: string;
  overall: number;
  dimensions: { name: string; score: number; weight: number; detail: string }[];
}

/** Verdict for a single fingerprint-pair comparison. "Pass" means low cross-site correlation
 * risk (overall similarity below the MEDIUM band) — the goal is looking distinct. */
export function buildFingerprintPairVerdict(result: FingerprintPairLike): Verdict {
  const risk = riskLevelFor(result.overall);
  const pass = result.overall < 50;
  const issues: VerdictIssue[] = result.dimensions
    .filter((d) => d.score >= 0.5)
    .map((d) => ({
      severity: d.score >= 0.8 ? 'high' : 'medium',
      message: `${d.name}: ${(d.score * 100).toFixed(0)}% similar — ${d.detail}`,
    }));
  const summary = `${result.overall.toFixed(1)}% similarity (${risk} risk) between "${result.nameA}" and "${result.nameB}"`;
  return { pass, score: result.overall, summary, issues };
}

/** Verdict across a similarity matrix (3+ fingerprints): pass when no pairwise score reaches
 * the MEDIUM-risk band (>=50). */
export function buildFingerprintMatrixVerdict(
  names: string[],
  pairs: { a: string; b: string; score: number }[],
): Verdict {
  const highRisk = pairs.filter((p) => p.score >= 50);
  const pass = highRisk.length === 0;
  const issues: VerdictIssue[] = highRisk.map((p) => ({
    severity: p.score >= 80 ? 'high' : 'medium',
    message: `${p.a} ↔ ${p.b}: ${p.score.toFixed(0)}% similar (${riskLevelFor(p.score)})`,
  }));
  const summary = pass
    ? `No high-risk pairs among ${names.length} fingerprints`
    : `${highRisk.length} high-risk pair(s) among ${names.length} fingerprints`;
  const score = pairs.length > 0 ? Math.max(...pairs.map((p) => p.score)) : 0;
  return { pass, score, summary, issues };
}

/**
 * Verdict for a semantic diff-report, computed directly from the two structured
 * SemanticSnapshot objects (the same source data `compareSemanticSnapshots` formats into prose —
 * never a re-parse of that prose). "Pass" means no semantic change detected in any category.
 */
export function buildDiffReportVerdict(before: SemanticSnapshot, after: SemanticSnapshot): Verdict {
  const issues: VerdictIssue[] = [];

  const fontsBefore = new Set(before.fonts);
  const fontsAfter = new Set(after.fonts);
  const addedFonts = [...fontsAfter].filter((f) => !fontsBefore.has(f));
  const removedFonts = [...fontsBefore].filter((f) => !fontsAfter.has(f));
  if (addedFonts.length > 0 || removedFonts.length > 0) {
    const parts: string[] = [];
    if (removedFonts.length > 0) parts.push(`-${removedFonts.join(', ')}`);
    if (addedFonts.length > 0) parts.push(`+${addedFonts.join(', ')}`);
    issues.push({ severity: 'medium', message: `Fonts changed: ${parts.join(' ')}` });
  }

  const headingsBefore = before.headings.map((h) => `H${h.level}: ${h.text}`);
  const headingsAfter = after.headings.map((h) => `H${h.level}: ${h.text}`);
  const addedHeadings = headingsAfter.filter((h) => !headingsBefore.includes(h));
  const removedHeadings = headingsBefore.filter((h) => !headingsAfter.includes(h));
  if (addedHeadings.length > 0 || removedHeadings.length > 0) {
    issues.push({
      severity: 'medium',
      message: `Heading structure changed: +${addedHeadings.length} -${removedHeadings.length}`,
    });
  }

  const colorsBefore = new Map(before.colors.map((c) => [`${c.element}:${c.property}`, c.value]));
  const colorsAfter = new Map(after.colors.map((c) => [`${c.element}:${c.property}`, c.value]));
  let colorChangeCount = 0;
  for (const [key, value] of colorsAfter) {
    const prev = colorsBefore.get(key);
    if (!prev || prev !== value) colorChangeCount++;
  }
  for (const key of colorsBefore.keys()) {
    if (!colorsAfter.has(key)) colorChangeCount++;
  }
  if (colorChangeCount > 0) {
    issues.push({
      severity: colorChangeCount > 10 ? 'medium' : 'low',
      message: `${colorChangeCount} color value(s) changed`,
    });
  }

  const varsBefore = new Map(before.cssVars.map((v) => [v.name, v.value]));
  const varsAfter = new Map(after.cssVars.map((v) => [v.name, v.value]));
  const varNames = new Set([...varsBefore.keys(), ...varsAfter.keys()]);
  let varChangeCount = 0;
  for (const name of varNames) {
    if (varsBefore.get(name) !== varsAfter.get(name)) varChangeCount++;
  }
  if (varChangeCount > 0) {
    issues.push({ severity: 'low', message: `${varChangeCount} CSS variable(s) changed` });
  }

  if (before.pageHeight !== after.pageHeight) {
    const delta = after.pageHeight - before.pageHeight;
    const pct = before.pageHeight > 0 ? (delta / before.pageHeight) * 100 : 0;
    issues.push({
      severity: Math.abs(pct) > 10 ? 'medium' : 'low',
      message: `Page height: ${before.pageHeight}px → ${after.pageHeight}px (${delta > 0 ? '+' : ''}${pct.toFixed(1)}%)`,
    });
  }

  if (before.elementCount !== after.elementCount) {
    issues.push({
      severity: 'low',
      message: `Element count: ${before.elementCount} → ${after.elementCount}`,
    });
  }

  if (before.title !== after.title) {
    issues.push({ severity: 'low', message: `Title: "${before.title}" → "${after.title}"` });
  }

  const pass = issues.length === 0;
  const summary = pass
    ? 'No semantic changes detected'
    : `${issues.length} semantic change categor${issues.length === 1 ? 'y' : 'ies'} detected`;
  return { pass, summary, issues };
}

/**
 * Helper: connect to browser, create page, navigate, run callback, clean up.
 * Reduces repeated boilerplate across MCP tool handlers.
 */
async function withBrowserPage<T>(url: string, fn: (page: any) => Promise<T>): Promise<T> {
  const { connectOrLaunch } = await import('./server.js');
  const { browser, owned } = await connectOrLaunch();
  let page: any = null;
  let ctx: any = null;
  try {
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await ctx.newPage();
    await navigateSafe(page, url, { timeout: 30000 });
    return await fn(page);
  } finally {
    if (page) await page.close().catch(() => {});
    if (ctx) await ctx.close().catch(() => {});
    await browser.close();
  }
}

/**
 * Start an MCP (Model Context Protocol) tool server over stdio.
 * Provides screenshot, diff, save-baseline, and list-baselines tools.
 */
export async function startMcpServer(): Promise<void> {
  let Server: any, StdioServerTransport: any;
  try {
    // Dynamic import to avoid hard dependency — SDK is optional
    const sdkPath = '@modelcontextprotocol/sdk/server/index.js';
    const transportPath = '@modelcontextprotocol/sdk/server/stdio.js';
    const sdk = await (Function('p', 'return import(p)') as (p: string) => Promise<any>)(sdkPath);
    Server = sdk.Server;
    const transport = await (Function('p', 'return import(p)') as (p: string) => Promise<any>)(
      transportPath,
    );
    StdioServerTransport = transport.StdioServerTransport;
  } catch {
    console.error(
      'looksy: @modelcontextprotocol/sdk not installed. For a global looksy install run: npm install -g @modelcontextprotocol/sdk (or reinstall looksy, which pulls it in as an optional dependency).',
    );
    process.exit(1);
  }

  const { readFileSync } = await import('node:fs');
  const { resolve: resolvePath } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  let version = '0.1.0';
  try {
    const pkgPath = resolvePath(fileURLToPath(import.meta.url), '../../package.json');
    version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    /* use fallback */
  }

  const server = new Server({ name: 'looksy', version }, { capabilities: { tools: {} } });

  server.setRequestHandler('tools/list' as any, async () => ({
    tools: [
      {
        name: 'screenshot',
        description: 'Screenshot a URL and return the image path + optional metadata',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to screenshot' },
            output: {
              type: 'string',
              description: 'Output path (default: /tmp/looksy/preview.png)',
            },
            mobile: { type: 'boolean', description: 'Use mobile viewport' },
            full: { type: 'boolean', description: 'Full page capture' },
            meta: { type: 'boolean', description: 'Extract metadata sidecar' },
            annotate: { type: 'boolean', description: 'Annotate elements with numbered boxes' },
            perf: { type: 'boolean', description: 'Core Web Vitals' },
            a11y: { type: 'boolean', description: 'Accessibility audit' },
            contrast: { type: 'boolean', description: 'WCAG contrast check' },
            compact: { type: 'boolean', description: 'Condensed output' },
            report: { type: 'boolean', description: 'Text-only summary' },
            check: {
              type: 'string',
              description:
                'Comma-separated pass/fail assertions, e.g. "contrast:aa, no-hscroll, touch-targets:24, heading-outline, og-tags" (full vocabulary: CHECK_ASSERTIONS in check.ts; unknown names fail explicitly)',
            },
            dismissConsent: {
              type: 'boolean',
              description: 'Click/hide cookie-consent banners before capture (--dismiss-consent)',
            },
            localStorage: {
              type: 'string',
              description: 'Seed localStorage before load, "k=v; k2=v2" (--local-storage)',
            },
            audit: { type: 'string', description: 'Design token audit pattern' },
            dark: { type: 'boolean', description: 'Dark color scheme' },
            selector: { type: 'string', description: 'Screenshot specific CSS selector' },
            wait: { type: 'number', description: 'Wait ms before screenshot' },
            interact: { type: 'string', description: 'Interaction chain before capture' },
            cssVars: { type: 'boolean', description: 'Extract CSS variables' },
            fonts: { type: 'boolean', description: 'Font loading check' },
            lighthouse: { type: 'boolean', description: 'Extended perf metrics' },
            domStats: { type: 'boolean', description: 'DOM complexity stats' },
            links: { type: 'boolean', description: 'Dead link check' },
            network: { type: 'boolean', description: 'Network waterfall' },
            coverage: { type: 'boolean', description: 'CSS/JS code coverage' },
            classAudit: { type: 'boolean', description: 'CSS class audit (fingerprint detection)' },
            fontSources: { type: 'boolean', description: 'Font file URL extraction' },
            assetHashes: { type: 'boolean', description: 'Hashed asset filename detection' },
            seo: { type: 'boolean', description: 'SEO audit' },
            schema: { type: 'boolean', description: 'JSON-LD structured data extraction' },
            visibleOnly: { type: 'boolean', description: 'Skip hidden elements in contrast check' },
            failOnAa: { type: 'boolean', description: 'Exit code 1 on WCAG AA failures' },
            failOnAaa: { type: 'boolean', description: 'Exit code 1 on WCAG AAA failures' },
            json: { type: 'boolean', description: 'Output metadata as JSON' },
            fold: { type: 'boolean', description: 'Viewport-only capture (above fold)' },
            micro: { type: 'boolean', description: 'Thumbnail mode (640px, JPEG q40)' },
            designSpec: { type: 'string', description: 'Path to design spec JSON for validation' },
            diffReport: { type: 'string', description: 'Baseline name for semantic diff report' },
            selectorAll: {
              type: 'boolean',
              description: 'Screenshot all matching selector elements',
            },
            bundles: { type: 'boolean', description: 'JS bundle analysis' },
            imageAudit: { type: 'boolean', description: 'Image audit (oversized, lazy/eager)' },
            compression: { type: 'boolean', description: 'Compression check (gzip/brotli)' },
            thirdParty: { type: 'boolean', description: 'Third-party resource impact' },
            cacheAudit: { type: 'boolean', description: 'Cache policy audit' },
            criticalPath: { type: 'boolean', description: 'Critical rendering path analysis' },
            resourceHints: { type: 'boolean', description: 'Resource hints audit' },
            serverTiming: { type: 'boolean', description: 'Server timing + TTFB breakdown' },
            budget: {
              type: 'string',
              description: 'Performance budget (inline or JSON file path)',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'save-baseline',
        description: 'Save a screenshot as a named baseline for visual regression',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to screenshot' },
            name: { type: 'string', description: 'Baseline name' },
          },
          required: ['url', 'name'],
        },
      },
      {
        name: 'diff-baseline',
        description: 'Compare current URL against a saved baseline',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to screenshot' },
            name: { type: 'string', description: 'Baseline name to compare against' },
          },
          required: ['url', 'name'],
        },
      },
      {
        name: 'list-baselines',
        description: 'List all saved baselines',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'fingerprint-collect',
        description: 'Collect a structural fingerprint from a URL for cross-site comparison',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fingerprint' },
            name: { type: 'string', description: 'Name to save fingerprint as' },
          },
          required: ['url', 'name'],
        },
      },
      {
        name: 'fingerprint-compare',
        description: 'Compare saved fingerprints and return similarity score',
        inputSchema: {
          type: 'object',
          properties: {
            names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Names of fingerprints to compare (2+)',
            },
            compact: { type: 'boolean', description: 'Condensed output' },
          },
          required: ['names'],
        },
      },
      {
        name: 'fingerprint-list',
        description: 'List all saved fingerprints',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'validate-theme',
        description:
          'Validate theme color pairs against WCAG AA/AAA (no browser needed). Accepts JSON or CSS files.',
        inputSchema: {
          type: 'object',
          properties: {
            configPath: { type: 'string', description: 'Path to theme config JSON or CSS file' },
            compact: { type: 'boolean', description: 'Condensed output' },
          },
          required: ['configPath'],
        },
      },
      {
        name: 'validate-contrast',
        description: 'Run WCAG contrast check on a URL and return structured results',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to check' },
            compact: { type: 'boolean', description: 'Condensed output' },
            visibleOnly: { type: 'boolean', description: 'Skip hidden elements' },
          },
          required: ['url'],
        },
      },
      {
        name: 'extract-colors',
        description: 'Extract color palette from a URL as structured JSON',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to extract colors from' },
          },
          required: ['url'],
        },
      },
      {
        name: 'check-fonts',
        description: 'Verify font families on page elements',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to check' },
            assertions: {
              type: 'string',
              description: 'Font assertions (e.g., "font:h1=Archivo Black, font:body=DM Sans")',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'validate-design',
        description: 'Validate a page against a design spec JSON file',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to validate' },
            specPath: { type: 'string', description: 'Path to design spec JSON' },
            compact: { type: 'boolean', description: 'Condensed output' },
          },
          required: ['url', 'specPath'],
        },
      },
      {
        name: 'diff-report',
        description:
          'Semantic diff between current page and a saved baseline (fonts, colors, CSS vars, headings)',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to compare' },
            baseline: { type: 'string', description: 'Baseline name to compare against' },
          },
          required: ['url', 'baseline'],
        },
      },
    ],
  }));

  server.setRequestHandler('tools/call' as any, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'screenshot': {
          const vp = args.mobile ? viewports.mobile : viewports.desktop;
          const config: ScreenshotConfig = {
            url: args.url,
            output: args.output || `${LOOKSY_DIR}/preview.png`,
            ...vp,
            fullPage: args.full || false,
            darkMode: args.dark || false,
            meta: args.meta,
            annotate: args.annotate,
            perf: args.perf,
            a11y: args.a11y,
            contrast: args.contrast,
            compact: args.compact,
            report: args.report,
            check: args.check,
            audit: args.audit,
            dismissConsent: args.dismissConsent,
            localStorage: args.localStorage,
            selector: args.selector,
            waitMs: args.wait,
            interact: args.interact,
            cssVars: args.cssVars,
            fonts: args.fonts,
            lighthouse: args.lighthouse,
            domStats: args.domStats,
            links: args.links,
            network: args.network,
            coverage: args.coverage,
            classAudit: args.classAudit,
            fontSources: args.fontSources,
            assetHashes: args.assetHashes,
            seo: args.seo,
            schema: args.schema,
            visibleOnly: args.visibleOnly,
            json: args.json,
            fold: args.fold,
            micro: args.micro,
            designSpec: args.designSpec,
            diffReport: args.diffReport,
            selectorAll: args.selectorAll,
            bundles: args.bundles,
            imageAudit: args.imageAudit,
            compression: args.compression,
            thirdParty: args.thirdParty,
            cacheAudit: args.cacheAudit,
            criticalPath: args.criticalPath,
            resourceHints: args.resourceHints,
            serverTiming: args.serverTiming,
            budget: args.budget,
          };
          const result = await screenshot(config);
          const content: any[] = [{ type: 'text', text: `Screenshot saved: ${result.imagePath}` }];
          const structured: Record<string, unknown> = {
            ok: true,
            imagePath: result.imagePath,
            imageSaved: result.imageSaved ?? true,
          };
          // Report contrast failures if fail-on flags set
          if (result.contrastFailures) {
            structured.contrastFailures = result.contrastFailures;
            const contrastGateFailed =
              (args.failOnAa && result.contrastFailures.aa > 0) ||
              (args.failOnAaa && result.contrastFailures.aaa > 0);
            structured.contrastGateFailed = Boolean(contrastGateFailed);
            if (contrastGateFailed) {
              content.push({
                type: 'text',
                text: `Contrast failures: ${result.contrastFailures.aa} AA, ${result.contrastFailures.aaa} AAA`,
              });
            }
          }
          if (result.metaPath) {
            structured.metaPath = result.metaPath;
            content.push({ type: 'text', text: `Metadata: ${result.metaPath}` });
          }
          if (result.reportText) content.push({ type: 'text', text: result.reportText });
          if (result.checkResults) content.push({ type: 'text', text: result.checkResults });
          if (result.checkResultsData) {
            structured.checks = {
              pass: result.checkResultsData.every((r) => r.pass),
              results: result.checkResultsData,
            };
          }
          if (result.responsiveCheckText) content.push({ type: 'text', text: result.responsiveCheckText });
          if (result.auditResults) content.push({ type: 'text', text: result.auditResults });
          if (result.elapsedMs != null) structured.elapsedMs = result.elapsedMs;
          // Include image as resource reference
          const mimeType =
            result.imagePath.endsWith('.jpg') || result.imagePath.endsWith('.jpeg')
              ? 'image/jpeg'
              : 'image/png';
          content.push({
            type: 'resource',
            resource: { uri: `file://${result.imagePath}`, mimeType },
          });
          return withStructured(content, structured);
        }

        case 'save-baseline': {
          const result = await screenshot({
            url: args.url,
            output: `${LOOKSY_DIR}/preview.png`,
            ...viewports.desktop,
            fullPage: false,
            darkMode: false,
          });
          const saved = saveBaseline(result.imagePath, args.name);
          // Also save a semantic baseline so --diff-report / diff-baseline work symmetrically.
          let semanticSaved = false;
          try {
            const { captureSemanticSnapshot, saveSemanticBaseline } =
              await import('./diff-report.js');
            await withBrowserPage(args.url, async (page) => {
              const snapshot = await captureSemanticSnapshot(page);
              saveSemanticBaseline(snapshot, args.name);
            });
            semanticSaved = true;
          } catch {
            /* best-effort: pixel baseline already saved */
          }
          const structured = { ok: true, name: args.name, path: saved, semanticSaved };
          return withStructured(
            [{ type: 'text', text: `Baseline "${args.name}" saved: ${saved}` }],
            structured,
          );
        }

        case 'diff-baseline': {
          const result = await screenshot({
            url: args.url,
            output: `${LOOKSY_DIR}/preview.png`,
            ...viewports.desktop,
            fullPage: false,
            darkMode: false,
          });
          const diff = await diffBaseline(result.imagePath, args.name, `${LOOKSY_DIR}/diff.png`);
          const verdict = buildDiffVerdict(diff);
          const structured = {
            ...verdict,
            diffPath: diff.diffPath,
            baselinePath: diff.baselinePath,
            changedPixels: diff.changedPixels,
            totalPixels: diff.totalPixels,
            changePercent: diff.changePercent,
            threshold: DEFAULT_DIFF_THRESHOLD,
          };
          return withStructured(
            [
              {
                type: 'text',
                text: `Diff: ${diff.diffPath}\nChanged: ${diff.changedPixels}/${diff.totalPixels} pixels (${diff.changePercent}%)`,
              },
              {
                type: 'resource',
                resource: { uri: `file://${diff.diffPath}`, mimeType: 'image/png' },
              },
            ],
            structured,
          );
        }

        case 'list-baselines': {
          const baselines = listBaselines();
          const text =
            baselines.length === 0
              ? 'No baselines saved.'
              : `Saved baselines:\n${baselines.map((b) => `  - ${b}`).join('\n')}`;
          const structured = { ok: true, baselines, count: baselines.length };
          return withStructured([{ type: 'text', text }], structured);
        }

        case 'fingerprint-collect': {
          const { collectFingerprint, saveFingerprint } = await import('./fingerprint.js');
          const dest = await withBrowserPage(args.url, async (pg) => {
            const fp = await collectFingerprint(pg, args.url);
            return saveFingerprint(fp, args.name);
          });
          const structured = { ok: true, name: args.name, path: dest };
          return withStructured(
            [{ type: 'text', text: `Fingerprint "${args.name}" saved: ${dest}` }],
            structured,
          );
        }

        case 'fingerprint-compare': {
          const {
            loadFingerprint,
            compareFingerprints,
            formatFingerprintCompare,
            formatSimilarityMatrix,
          } = await import('./fingerprint.js');
          const names: string[] = args.names;
          const fingerprints = names.map((n: string) => loadFingerprint(n));
          let text: string;
          let structured: Record<string, unknown>;
          if (names.length === 2) {
            const result = compareFingerprints(
              fingerprints[0],
              fingerprints[1],
              names[0],
              names[1],
            );
            text = formatFingerprintCompare(result, { compact: args.compact });
            const verdict = buildFingerprintPairVerdict(result);
            structured = {
              ...verdict,
              nameA: result.nameA,
              nameB: result.nameB,
              overall: result.overall,
              dimensions: result.dimensions,
            };
          } else {
            text = formatSimilarityMatrix(fingerprints, names);
            // Same pairwise computation formatSimilarityMatrix does internally, kept here so we
            // can build a verdict from the structured scores instead of the rendered table.
            const pairs: { a: string; b: string; score: number }[] = [];
            for (let i = 0; i < names.length; i++) {
              for (let j = i + 1; j < names.length; j++) {
                const r = compareFingerprints(fingerprints[i], fingerprints[j], names[i], names[j]);
                pairs.push({ a: names[i], b: names[j], score: r.overall });
              }
            }
            const verdict = buildFingerprintMatrixVerdict(names, pairs);
            structured = { ...verdict, names, pairs };
          }
          return withStructured([{ type: 'text', text }], structured);
        }

        case 'fingerprint-list': {
          const { listFingerprints } = await import('./fingerprint.js');
          const fps = listFingerprints();
          const text =
            fps.length === 0
              ? 'No fingerprints saved.'
              : `Saved fingerprints:\n${fps.map((f: string) => `  - ${f}`).join('\n')}`;
          const structured = { ok: true, fingerprints: fps, count: fps.length };
          return withStructured([{ type: 'text', text }], structured);
        }

        case 'validate-theme': {
          const { runThemeValidation, parseColor } = await import('./validate-theme.js');
          const { suggestContrastFix } = await import('./contrast.js');
          const { text, results } = runThemeValidation(args.configPath, {
            compact: args.compact,
          });
          const fixFor = (r: ThemeValidationResult): string | undefined => {
            const fgRgb = parseColor(r.fg);
            const bgRgb = parseColor(r.bg);
            if (!fgRgb || !bgRgb) return undefined;
            const fix = suggestContrastFix(fgRgb, bgRgb, 4.5);
            if (!fix) return undefined;
            return `${fix.direction} ${fix.type} to ${fix.hex} for ${fix.ratio.toFixed(1)}:1`;
          };
          const verdict = buildThemeVerdict(results, { fixFor });
          const structured = { ...verdict, configPath: args.configPath, results };
          return withStructured([{ type: 'text', text }], structured);
        }

        case 'validate-contrast': {
          const { extractContrast, suggestContrastFix } = await import('./contrast.js');
          const { parseColor } = await import('./validate-theme.js');
          const cr = await withBrowserPage(args.url, (pg) =>
            extractContrast(pg, { compact: args.compact, visibleOnly: args.visibleOnly }),
          );
          const fixFor = (p: ContrastPairResult): string | undefined => {
            const fgRgb = parseColor(p.color);
            const bgRgb = parseColor(p.bg);
            if (!fgRgb || !bgRgb) return undefined;
            const fix = suggestContrastFix(fgRgb, bgRgb, 4.5);
            if (!fix) return undefined;
            return `${fix.direction} ${fix.type} to ${fix.hex} for ${fix.ratio.toFixed(1)}:1`;
          };
          const verdict = buildContrastVerdict(cr.pairs, { fixFor });
          const structured = {
            ...verdict,
            url: args.url,
            aaFailures: cr.aaFailures,
            aaaFailures: cr.aaaFailures,
            sampled: cr.sampled,
            total: cr.total,
            capped: cr.capped,
            pairs: cr.pairs,
          };
          return withStructured([{ type: 'text', text: cr.text }], structured);
        }

        case 'extract-colors': {
          const { extractMetadata } = await import('./metadata.js');
          const meta = await withBrowserPage(args.url, (pg) => extractMetadata(pg));
          const structured = {
            ok: true,
            url: args.url,
            colors: meta.colors,
            fonts: meta.fonts,
            colorCount: meta.colors.length,
            fontCount: meta.fonts.length,
          };
          return withStructured(
            [
              {
                type: 'text',
                text: `Extracted ${meta.colors.length} color(s) and ${meta.fonts.length} font(s) from ${args.url}`,
              },
            ],
            structured,
          );
        }

        case 'check-fonts': {
          const { runChecksStructured } = await import('./check.js');
          const cr = await withBrowserPage(args.url, (pg) => runChecksStructured(pg, args.assertions));
          const structured = {
            ok: true,
            url: args.url,
            pass: cr.allPass,
            results: cr.results,
            failed: cr.results.filter((r) => !r.pass).map((r) => r.assertion),
            unknownAssertions: cr.results.filter((r) => r.unknown).map((r) => r.assertion),
            resultText: cr.text,
          };
          return withStructured([{ type: 'text', text: cr.text }], structured);
        }

        case 'validate-design': {
          const { loadDesignSpec, validateDesign, formatDesignValidation } =
            await import('./design-spec.js');
          const spec = loadDesignSpec(args.specPath);
          const { results, text } = await withBrowserPage(args.url, async (pg) => {
            const r = await validateDesign(pg, spec);
            return { results: r, text: formatDesignValidation(r, { compact: args.compact }) };
          });
          const verdict = buildDesignVerdict(results);
          const structured = { ...verdict, url: args.url, specPath: args.specPath, results };
          return withStructured([{ type: 'text', text }], structured);
        }

        case 'diff-report': {
          const { captureSemanticSnapshot, loadSemanticBaseline, compareSemanticSnapshots } =
            await import('./diff-report.js');
          const baseline = loadSemanticBaseline(args.baseline);
          const { text, verdict } = await withBrowserPage(args.url, async (pg) => {
            const current = await captureSemanticSnapshot(pg);
            return {
              text: compareSemanticSnapshots(baseline, current),
              verdict: buildDiffReportVerdict(baseline, current),
            };
          });
          const structured = { ...verdict, url: args.url, baseline: args.baseline };
          return withStructured([{ type: 'text', text }], structured);
        }

        default: {
          const structured = { ok: false, error: `Unknown tool: ${name}` };
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }, jsonBlock(structured)],
            structuredContent: structured,
            isError: true,
          };
        }
      }
    } catch (err: any) {
      return errorResult(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
