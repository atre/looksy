import type { Browser } from 'playwright';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { connectOrLaunch } from './server.js';
import { navigateSafe, stabilizePage, tagLooksyConsoleError } from './navigate.js';
import { extractMetadata, formatMetadata } from './metadata.js';
import { annotateElements } from './annotate.js';
import { parseInteractions, executeInteractions } from './interact.js';
import { screenshotSections } from './sections.js';
import { captureFilmstrip } from './filmstrip.js';
import { generateReport } from './report.js';
import { runChecksStructured } from './check.js';
import { runAudit } from './audit.js';
import { extractCoverage, formatCoverage } from './coverage.js';
import { loadDesignSpec, validateDesign, formatDesignValidation } from './design-spec.js';
import {
  captureSemanticSnapshot,
  loadSemanticBaseline,
  compareSemanticSnapshots,
  hasSemanticBaseline,
} from './diff-report.js';
import {
  captureDeltaSnapshot,
  loadLastSnapshot,
  saveLastSnapshot,
  compareDeltaSnapshots,
} from './delta.js';
import { formatSuggestions } from './suggest.js';
import { injectLayoutOverlay } from './layout.js';
import { saveToHistory } from './history.js';
import { extractPerf } from './perf.js';
import { loadBudgetConfig, checkBudget, formatBudget, type BudgetActuals } from './budget.js';
import { runResponsiveCheck, formatResponsiveCheck } from './responsive-check.js';
import { safeRun, type ScreenshotConfig, type ScreenshotResult } from './screenshot-types.js';
import { buildAnalysisModules } from './screenshot-analysis.js';
import type { CacheHeaderInfo } from './cache-audit.js';
import { summarize } from './analysis-summary.js';
import { buildSuggestInput } from './screenshot-suggest.js';
import { captureMainScreenshot } from './screenshot-capture.js';
import { prepareContext, dismissConsent } from './page-prep.js';
import { toFindings } from './findings.js';

export { safeRun } from './screenshot-types.js';
export type { ScreenshotConfig, ScreenshotResult } from './screenshot-types.js';

export async function screenshot(config: ScreenshotConfig): Promise<ScreenshotResult> {
  // Fail fast before launching Chromium: if a diff-report baseline is requested
  // but missing, don't waste the browser roundtrip just to report it at the end.
  if (config.diffReport && !hasSemanticBaseline(config.diffReport)) {
    throw new Error(
      `Semantic baseline "${config.diffReport}" not found. Run: looksy save <url> ${config.diffReport}`,
    );
  }

  // --fold: force viewport-only capture (overrides --full)
  if (config.fold) {
    config = { ...config, fullPage: false, maxHeight: undefined };
  }

  // --micro: thumbnail mode (640px wide, jpeg q40)
  if (config.micro) {
    const ratio = 640 / config.width;
    config = {
      ...config,
      width: 640,
      height: Math.round(config.height * ratio),
      format: 'jpeg',
      quality: 40,
    };
  }

  const startTime = Date.now();
  const ext = config.format === 'jpeg' ? '.jpg' : '.png';
  const outputPath = resolve(config.output.replace(/\.(png|jpg|jpeg)$/, ext));
  const outputDir = dirname(outputPath);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let browser: Browser;
  let owned: boolean;
  // Only tear down the browser if THIS call acquired it. When a batch passes a shared
  // `config.browser`, the caller owns its lifecycle — closing it here would yank it out
  // from under sibling captures still in flight ("Target page, context or browser has
  // been closed"). owned tracks launched-vs-connected (for the --serve hint); shouldClose
  // tracks acquired-here-vs-passed-in.
  let shouldClose: boolean;

  if (config.browser) {
    browser = config.browser;
    owned = false;
    shouldClose = false;
  } else {
    ({ browser, owned } = await connectOrLaunch({ hostResolverRule: config.hostResolverRule }));
    shouldClose = true;
  }

  try {
    const contextOpts: Record<string, any> = {
      viewport: { width: config.width, height: config.height },
      colorScheme: config.darkMode ? 'dark' : 'light',
    };
    if (config.storageState) contextOpts.storageState = config.storageState;
    if (config.basicAuth) {
      const colonIdx = config.basicAuth.indexOf(':');
      const username = colonIdx >= 0 ? config.basicAuth.slice(0, colonIdx) : config.basicAuth;
      const password = colonIdx >= 0 ? config.basicAuth.slice(colonIdx + 1) : '';
      contextOpts.httpCredentials = { username, password };
    }
    if (config.har) {
      contextOpts.recordHar = {
        path: outputPath.replace(/\.(png|jpg|jpeg)$/, '.har'),
        mode: 'full',
      };
    }

    const context = await browser.newContext(contextOpts);

    // --cookie / --local-storage: seeded before navigation (consent cookies, feature flags, auth).
    await prepareContext(context, config.url, {
      cookie: config.cookie,
      localStorage: config.localStorage,
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    let result_consent: ScreenshotResult['consentDismissed'];

    let cdpSession: any = null;
    if (config.coverage) {
      try {
        cdpSession = await context.newCDPSession(page);
        await cdpSession.send('Profiler.enable');
        await cdpSession.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
        await cdpSession.send('CSS.enable');
        await cdpSession.send('CSS.startRuleUsageTracking');
      } catch {
        cdpSession = null;
      }
    }

    // Filmstrip explicitly wants motion across its frames, so stabilizePage opts out there;
    // --record never reaches this function at all (recordVideo() is a separate pipeline).
    const filmstripActive = Boolean(config.filmstrip && config.filmstrip > 0);

    // stabilizePage's freeze rule and --inject both land as an inline <style> tag, which a
    // page with a strict style-src CSP refuses — tag (never drop) so that noise doesn't
    // masquerade as a real page bug in the ## Errors block.
    const looksyStyleActive =
      Boolean(config.inject) || ((config.stabilize ?? true) && !filmstripActive);
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      consoleErrors.push(tagLooksyConsoleError(msg.text(), looksyStyleActive));
    });

    // --cache-audit: header-based classification needs the real response headers, which
    // performance.getEntriesByType('resource') never carries — captured live since Playwright
    // reports transferSize=0 (and sometimes small non-zero values) for memory/disk cache hits
    // regardless of what the server actually sent.
    const cacheHeadersByUrl = new Map<string, CacheHeaderInfo>();
    page.on('response', (resp) => {
      try {
        const headers = resp.headers();
        cacheHeadersByUrl.set(resp.url(), {
          cacheControl: headers['cache-control'],
          age: headers['age'],
          cfCacheStatus: headers['cf-cache-status'],
        });
      } catch {
        // best-effort; a resource with unreadable headers just falls back to the no-header path
      }
    });

    const { response, idleTimedOut } = await navigateSafe(page, config.url, {
      timeout: config.timeout,
      errors: consoleErrors,
    });

    let httpStatus: number | undefined;
    if (response) {
      const status = response.status();
      if (status >= 400) {
        httpStatus = status;
        const msg = `HTTP ${status} from ${config.url}`;
        consoleErrors.push(msg);
        // --brief folds the status into its ✗ line — a second stderr warning would just be noise.
        if (!config.brief) console.error(`Warning: ${msg}`);
      }
    }

    if (config.waitMs) await page.waitForTimeout(config.waitMs);

    // --dismiss-consent: click/hide the CMP banner before anything measures or captures the page.
    if (config.dismissConsent) {
      const outcome = await safeRun(() => dismissConsent(page), consoleErrors, 'Consent');
      result_consent = outcome ?? { action: 'none' };
    }

    if (config.inject) {
      await page.addStyleTag({ content: config.inject });
    }

    if (config.interact) {
      await safeRun(
        async () => {
          const actions = parseInteractions(config.interact!);
          await executeInteractions(page, actions);
        },
        consoleErrors,
        'Interact',
      );
    }

    const pageInfo = await page.evaluate((viewportWidth: number) => {
      const docEl = document.documentElement;
      const width = docEl.scrollWidth;
      const height = docEl.scrollHeight;
      const title = document.title;

      // Name the overflow culprit: top-3 elements/text whose own box extends past the
      // viewport, by right edge. Same walk+dedupe as responsive-check.ts's per-breakpoint
      // scan (duplicated rather than shared — page.evaluate ships the function's own source,
      // so a cross-module helper reference would be undefined in the browser).
      const overflowCulprits: Array<{
        tag: string;
        text: string;
        right: number;
        className: string;
      }> = [];
      if (width > viewportWidth) {
        type Culprit = { el: Element; right: number; text: string };
        const candidates: Culprit[] = [];
        for (const el of document.querySelectorAll('*')) {
          const rect = el.getBoundingClientRect();
          if (rect.right > viewportWidth) {
            candidates.push({
              el,
              right: rect.right,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            });
          }
        }
        const walker = document.createTreeWalker(document.body || docEl, NodeFilter.SHOW_TEXT);
        let textNode: Node | null;
        while ((textNode = walker.nextNode())) {
          const raw = textNode.textContent;
          if (!raw || !raw.trim()) continue;
          const parent = textNode.parentElement;
          if (!parent) continue;
          const range = document.createRange();
          range.selectNodeContents(textNode);
          let maxRight = 0;
          for (const r of range.getClientRects()) {
            if (r.right > maxRight) maxRight = r.right;
          }
          if (maxRight > viewportWidth) {
            candidates.push({ el: parent, right: maxRight, text: raw.replace(/\s+/g, ' ').trim() });
          }
        }
        const depthOf = (el: Element): number => {
          let d = 0;
          for (let p = el.parentElement; p; p = p.parentElement) d++;
          return d;
        };
        candidates.sort((a, b) => depthOf(a.el) - depthOf(b.el));
        const selected: Culprit[] = [];
        for (const c of candidates) {
          if (selected.some((s) => s.el === c.el || s.el.contains(c.el))) continue;
          selected.push(c);
        }
        selected.sort((a, b) => b.right - a.right);
        for (const c of selected.slice(0, 3)) {
          overflowCulprits.push({
            tag: c.el.tagName.toLowerCase(),
            text: c.text.slice(0, 40),
            right: Math.round(c.right),
            className: (c.el.getAttribute('class') || '').trim().slice(0, 80),
          });
        }
      }

      return { width, height, title, overflowCulprits };
    }, config.width);

    const result: ScreenshotResult = {
      imagePath: outputPath,
      url: config.url,
      pageInfo: {
        ...pageInfo,
        viewportWidth: config.width,
        overflowCulprits:
          pageInfo.overflowCulprits.length > 0 ? pageInfo.overflowCulprits : undefined,
      },
    };
    if (result_consent) result.consentDismissed = result_consent;
    if (httpStatus !== undefined) result.httpStatus = httpStatus;
    if (idleTimedOut) result.networkIdleTimeout = true;
    // jsonData is the in-memory bus between analyzers and --suggest/--budget; without it,
    // --design's suggestions silently saw only contrast pairs unless --json was also on.
    if (config.json || config.suggest || config.budget) result.jsonData = {};
    const compact = config.compact ?? false;

    const visualFlags =
      config.meta ||
      config.annotate ||
      config.perf ||
      config.a11y ||
      config.contrast ||
      config.network ||
      config.sections ||
      config.filmstrip ||
      config.cssVars ||
      config.fonts ||
      config.lighthouse ||
      config.domStats ||
      config.links ||
      config.classAudit ||
      config.fontSources ||
      config.assetHashes ||
      config.seo ||
      config.schema ||
      config.delta ||
      config.suggest ||
      config.layout ||
      config.bundles ||
      config.imageAudit ||
      config.compression ||
      config.thirdParty ||
      config.cacheAudit ||
      config.criticalPath ||
      config.resourceHints ||
      config.serverTiming ||
      config.budget;
    // forceScreenshot: an explicit -o/--name/--suffix alongside a text-only mode (--report
    // etc.) means the caller wants a PNG at that path — don't silently skip capturing it
    // just because --report on its own is "text-only, no screenshot needed".
    const textOnly =
      !visualFlags && !config.forceScreenshot && (config.report || config.check || config.audit);

    // Annotate (modifies DOM — must happen before screenshot)
    if (config.annotate) {
      result.legend = await annotateElements(page);
    }

    // Layout overlay (modifies DOM — must happen before screenshot, like annotate)
    if (config.layout) {
      result.layoutLegend = await safeRun(() => injectLayoutOverlay(page), consoleErrors, 'Layout');
    }

    // Stabilize immediately before capture/analysis: settle web fonts (capped) and
    // freeze animations/transitions so FOUT and mid-transition frames don't poison the
    // screenshot or the contrast/a11y sampling that runs later against this same page.
    if ((config.stabilize ?? true) && !filmstripActive) {
      await safeRun(() => stabilizePage(page), consoleErrors, 'Stabilize');
    }

    if (!textOnly && !config.pdf) {
      const outcome = await captureMainScreenshot(
        page,
        {
          outputPath,
          width: config.width,
          pageHeight: pageInfo.height,
          fullPage: config.fullPage,
          maxHeight: config.maxHeight,
          format: config.format,
          quality: config.quality,
          selector: config.selector,
          selectorAll: config.selectorAll,
        },
        consoleErrors,
      );
      result.imageSaved = true;
      if (outcome.selectorAllPaths) result.selectorAllPaths = outcome.selectorAllPaths;
    }

    if (config.pdf) {
      const pdfPath = outputPath.replace(/\.(png|jpg|jpeg)$/, '.pdf');
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      result.imagePath = pdfPath;
    }

    if (config.filmstrip && config.filmstrip > 0) {
      const filmstripPath = outputPath.replace(/\.(png|jpg|jpeg)$/, '-filmstrip.png');
      const path = await safeRun(
        () =>
          captureFilmstrip(page, filmstripPath, {
            frames: 8,
            duration: config.filmstrip!,
            scroll: config.filmstripScroll,
          }),
        consoleErrors,
        'Filmstrip',
      );
      if (path) result.filmstripPath = path;
    }

    if (config.sections) {
      result.sectionResults = await safeRun(
        () => screenshotSections(page, outputPath),
        consoleErrors,
        'Sections',
      );
    }

    // Text-mode analysis
    if (config.report) {
      result.reportText = await safeRun(
        () => generateReport(page, { width: config.width, height: config.height }, config.url),
        consoleErrors,
        'Report',
      );
      if (result.jsonData && result.reportText) result.jsonData.report = result.reportText;
    }
    if (config.check) {
      const cr = await safeRun(
        () => runChecksStructured(page, config.check!, { contrastLimit: config.contrastLimit }),
        consoleErrors,
        'Check',
      );
      if (cr) {
        result.checkResults = cr.text;
        result.checkResultsData = cr.results;
        if (result.jsonData)
          result.jsonData.check = { allPass: cr.allPass, results: cr.results, text: cr.text };
      }
    }
    if (config.audit) {
      result.auditResults = await safeRun(
        () => runAudit(page, config.audit!),
        consoleErrors,
        'Audit',
      );
      if (result.jsonData && result.auditResults) result.jsonData.audit = result.auditResults;
    }

    if (config.designSpec) {
      result.designSpecResults = await safeRun(
        async () => {
          const spec = loadDesignSpec(config.designSpec!);
          const results = await validateDesign(page, spec);
          if (result.jsonData) result.jsonData.designSpec = results;
          return formatDesignValidation(results, { compact: config.compact });
        },
        consoleErrors,
        'Design Spec',
      );
    }

    if (config.diffReport) {
      result.diffReportText = await safeRun(
        async () => {
          const current = await captureSemanticSnapshot(page);
          const baseline = loadSemanticBaseline(config.diffReport!);
          const report = compareSemanticSnapshots(baseline, current);
          if (result.jsonData) result.jsonData.diffReport = report;
          return report;
        },
        consoleErrors,
        'Diff Report',
      );
    }

    const wantsMeta =
      config.meta ||
      config.perf ||
      config.a11y ||
      config.contrast ||
      config.network ||
      config.annotate ||
      config.report ||
      config.check ||
      config.audit ||
      config.cssVars ||
      config.fonts ||
      config.lighthouse ||
      config.domStats ||
      config.links ||
      config.coverage ||
      config.classAudit ||
      config.fontSources ||
      config.assetHashes ||
      config.seo ||
      config.schema ||
      config.designSpec ||
      config.diffReport ||
      config.delta ||
      config.suggest ||
      config.layout ||
      config.bundles ||
      config.imageAudit ||
      config.compression ||
      config.thirdParty ||
      config.cacheAudit ||
      config.criticalPath ||
      config.resourceHints ||
      config.serverTiming ||
      config.budget;

    if (wantsMeta) {
      const metaPath = outputPath.replace(/\.(png|jpg|jpeg|pdf)$/, '.meta.md');
      const sections: string[] = [];

      if (config.report && result.reportText) sections.push(result.reportText);
      if (config.check && result.checkResults) sections.push(result.checkResults);
      if (config.audit && result.auditResults) sections.push(result.auditResults);
      if (config.designSpec && result.designSpecResults) sections.push(result.designSpecResults);
      if (config.diffReport && result.diffReportText) sections.push(result.diffReportText);

      if (config.meta) {
        const text = await safeRun(
          async () => {
            const metadata = await extractMetadata(page);
            metadata.viewport = { width: config.width, height: config.height };
            metadata.consoleErrors = consoleErrors;
            if (result.jsonData) result.jsonData.metadata = metadata;
            return formatMetadata(metadata, { compact, tailwind: config.tailwind });
          },
          consoleErrors,
          'Metadata',
        );
        if (text) sections.push(text);
      }

      // Analysis modules run in parallel
      const analysisModules = buildAnalysisModules(
        page,
        config,
        result,
        compact,
        cacheHeadersByUrl,
      );
      const activeModules = analysisModules.filter((mod) => mod.flag);
      const moduleResults = await Promise.all(
        activeModules.map((mod) => safeRun(mod.run, consoleErrors, mod.key)),
      );
      for (const r of moduleResults) {
        if (!r) continue;
        if (r.section) sections.push(r.section);
        if (r.summary) (result.analysisSummaries ??= []).push(r.summary);
      }

      // Delta comparison (before saving history)
      if (config.delta) {
        const deltaText = await safeRun(
          async () => {
            const snapshot = await captureDeltaSnapshot(page, config.url);
            const previous = loadLastSnapshot(config.url);
            saveLastSnapshot(snapshot);
            if (previous) {
              const text = compareDeltaSnapshots(previous, snapshot);
              if (result.jsonData)
                result.jsonData.delta = { previous, current: snapshot, diff: text };
              return text;
            }
            if (result.jsonData) result.jsonData.delta = { current: snapshot, diff: null };
            return '## Delta: First capture (no previous snapshot to compare)\n';
          },
          consoleErrors,
          'Delta',
        );
        if (deltaText) {
          result.deltaText = deltaText;
          sections.push(deltaText);
        }
      }

      // Suggest aggregates data from earlier analysis modules
      if (config.suggest) {
        const suggestText = await safeRun(
          async () => {
            const input = buildSuggestInput(result.jsonData, result.contrastPairs, config.fragment);
            const text = formatSuggestions(input, { compact });
            if (result.jsonData) result.jsonData.suggest = text;
            return text;
          },
          consoleErrors,
          'Suggest',
        );
        if (suggestText) {
          result.suggestText = suggestText;
          sections.push(suggestText);
        }
      }

      // Budget check (needs data from other modules)
      if (config.budget) {
        const budgetText = await safeRun(
          async () => {
            const budgetConfig = loadBudgetConfig(config.budget!);
            const actuals: BudgetActuals = {};
            if (result.jsonData?.perf) {
              actuals.FCP = result.jsonData.perf.fcp;
              actuals.LCP = result.jsonData.perf.lcp;
              actuals.CLS = result.jsonData.perf.cls;
              actuals.TTFB = result.jsonData.perf.ttfb;
              actuals.requestCount = result.jsonData.perf.resourceCount;
              actuals.totalTransfer = result.jsonData.perf.totalTransferSize;
            }
            if (result.jsonData?.bundles) {
              actuals.totalJS = result.jsonData.bundles.totalTransferSize;
            }
            if (result.jsonData?.imageAudit) {
              actuals.totalImages = result.jsonData.imageAudit.totalTransferSize;
              actuals.imageCount = result.jsonData.imageAudit.totalCount;
            }
            if (!actuals.FCP) {
              const perf = await extractPerf(page);
              actuals.FCP = perf.fcp;
              actuals.LCP = perf.lcp;
              actuals.CLS = perf.cls;
              actuals.TTFB = perf.ttfb;
              actuals.requestCount = perf.resourceCount;
              actuals.totalTransfer = perf.totalTransferSize;
            }
            const budgetData = checkBudget(budgetConfig, actuals);
            result.budgetResults = budgetData;
            if (result.jsonData) result.jsonData.budget = budgetData;
            return formatBudget(budgetData, { compact });
          },
          consoleErrors,
          'Budget',
        );
        if (budgetText) {
          result.budgetText = budgetText;
          sections.push(budgetText);
        }
      }

      if (config.annotate && result.legend) {
        const lines = ['## Element Annotations\n'];
        for (const line of result.legend) lines.push(`- ${line}`);
        lines.push('');
        sections.push(lines.join('\n'));
      }

      if (config.layout && result.layoutLegend) {
        const lines = ['## Layout Containers\n'];
        for (const line of result.layoutLegend) lines.push(`- ${line}`);
        lines.push('');
        sections.push(lines.join('\n'));
      }

      if (config.sections && result.sectionResults) {
        const lines = ['## Sections\n'];
        for (const s of result.sectionResults) {
          lines.push(
            `- **${s.index}.** \`${s.tag}${s.label !== s.tag ? '.' + s.label : ''}\` [${Math.round(s.rect.width)}x${Math.round(s.rect.height)}]${s.heading ? ` — ${s.heading}` : ''}`,
          );
          lines.push(`  → ${s.path}`);
        }
        lines.push('');
        sections.push(lines.join('\n'));
      }

      if (config.coverage && cdpSession) {
        const text = await safeRun(
          async () => {
            const d = await extractCoverage(cdpSession);
            if (result.jsonData) result.jsonData.coverage = d;
            const s = summarize('coverage', d);
            if (s) (result.analysisSummaries ??= []).push(s);
            return formatCoverage(d, { compact });
          },
          consoleErrors,
          'Coverage',
        );
        if (text) sections.push(text);
      }

      // Responsive check runs its own browser contexts at different viewports.
      // MUST reuse this flow's browser: a second connectOrLaunch() against a busy
      // --serve server never resolves (chromium.connect has no default timeout),
      // which used to hang the whole CLI indefinitely.
      if (config.responsiveCheck) {
        const rcText = await safeRun(
          async () => {
            const rcResult = await runResponsiveCheck(config.url, browser, {
              targetSize: config.targetSize,
              visibleOnly: config.visibleOnly,
              contrast: config.contrast,
              contrastLimit: config.contrastLimit,
              cookie: config.cookie,
              localStorage: config.localStorage,
              dismissConsent: config.dismissConsent,
              timeout: config.timeout,
            });
            result.responsiveCheckResult = rcResult;
            if (result.jsonData) result.jsonData.responsiveCheck = rcResult;
            const text = formatResponsiveCheck(rcResult, { compact, limit: config.listLimit });
            result.responsiveCheckText = text;
            const s = summarize('responsiveCheck', rcResult);
            if (s) (result.analysisSummaries ??= []).push(s);
            return text;
          },
          consoleErrors,
          'ResponsiveCheck',
        );
        if (rcText) sections.push(rcText);
      }

      const content = sections.join('\n');
      if (config.json && result.jsonData) {
        result.jsonData.findings = toFindings([{ url: config.url, result }]);
        const jsonPath = outputPath.replace(/\.(png|jpg|jpeg|pdf)$/, '.meta.json');
        writeFileSync(jsonPath, JSON.stringify(result.jsonData, null, 2), 'utf-8');
        if (config.metaMd) {
          // Both: .meta.json for CI/batch-report, .meta.md as the agent-readable sidecar.
          writeFileSync(metaPath, content, 'utf-8');
          result.metaPath = metaPath;
          result.jsonPath = jsonPath;
        } else {
          result.metaPath = jsonPath;
        }
      } else {
        writeFileSync(metaPath, content, 'utf-8');
        result.metaPath = metaPath;
      }
    }

    // Extract page snapshot for cross-page consistency (before closing context)
    if (config.consistency) {
      try {
        const { extractPageSnapshot } = await import('./consistency.js');
        result.pageSnapshot = await extractPageSnapshot(page);
        result.pageSnapshot.url = config.url;
      } catch {
        /* best-effort */
      }
    }

    await context.close();

    if (config.history && !textOnly) {
      try {
        result.historyPath = saveToHistory(outputPath, config.url, config.historyLabel);
      } catch {
        /* best-effort */
      }
    }

    result.ownedBrowser = owned;
    result.elapsedMs = Date.now() - startTime;
    return result;
  } finally {
    if (shouldClose) await browser.close();
  }
}
