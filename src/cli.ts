import { parseArgs } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { screenshot, type ScreenshotResult } from './screenshot.js';
import { viewports } from './viewports.js';
import { readStdin, htmlToTempUrl, cleanupTempHtml } from './html-pipe.js';
import { diffInline } from './diff-inline.js';
import { startWatch } from './watch.js';
import { responsiveSweep } from './sweep.js';
import { startServer, stopServer, connectOrLaunch, withBrowser, setCdpEndpoint } from './server.js';
import { compareSnapshots } from './consistency.js';
import { extractLocaleSnapshot, compareLocales } from './i18n-check.js';
import { startStaticServer, type StaticServer } from './static-server.js';
import { runResponsiveCheck, formatResponsiveCheck } from './responsive-check.js';
import { fetchSitemapPaths } from './sitemap.js';
import { captureComponents } from './components.js';
import { navigateSafe } from './navigate.js';
import { pMapSettled, LOOKSY_DIR } from './utils.js';
import { printHelp } from './cli-help.js';
import {
  checkContrastExit,
  flagFailedChecks,
  printResult,
  formatOverflowFlag,
  formatBrief,
  briefIsRed,
  isRed,
} from './cli-output.js';
import { handleSubcommand } from './cli-subcommands.js';
import {
  validateNumeric,
  resolveUrl,
  applySuffix,
  resolveViewport,
  configureFleet,
  parseHostResolverRule,
  combineInject,
  validateFloat,
  resolveOutputTarget,
  urlToOutputSuffix,
} from './cli-utils.js';

// Re-exported for external consumers (tests import from dist/cli.js)
export {
  validateNumeric,
  validateFloat,
  resolveUrl,
  applySuffix,
  resolveViewport,
  configureFleet,
  parseHostResolverRule,
  combineInject,
  resolveOutputTarget,
  urlToOutputSuffix,
};

const DEFAULT_OUTPUT = `${LOOKSY_DIR}/preview.png`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    strict: true,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'output-dir': { type: 'string' },
      mobile: { type: 'boolean', default: false },
      tablet: { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
      width: { type: 'string' },
      height: { type: 'string' },
      selector: { type: 'string' },
      multi: { type: 'boolean', default: false },
      wait: { type: 'string' },
      dark: { type: 'boolean', default: false },
      meta: { type: 'boolean', default: false },
      annotate: { type: 'boolean', default: false },
      perf: { type: 'boolean', default: false },
      a11y: { type: 'boolean', default: false },
      contrast: { type: 'boolean', default: false },
      network: { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
      report: { type: 'boolean', default: false },
      check: { type: 'string' },
      audit: { type: 'string' },
      html: { type: 'boolean', default: false },
      fragment: { type: 'boolean', default: false },
      interact: { type: 'string' },
      inject: { type: 'string' },
      ignore: { type: 'string' },
      cdp: { type: 'string' },
      'no-stabilize': { type: 'boolean', default: false },
      'diff-inline': { type: 'string' },
      watch: { type: 'string' },
      sweep: { type: 'boolean', default: false },
      'sweep-widths': { type: 'string' },
      sections: { type: 'boolean', default: false },
      filmstrip: { type: 'string' },
      'filmstrip-scroll': { type: 'string' },
      format: { type: 'string' },
      quality: { type: 'string' },
      'dom-stats': { type: 'boolean', default: false },
      'css-vars': { type: 'boolean', default: false },
      fonts: { type: 'boolean', default: false },
      lighthouse: { type: 'boolean', default: false },
      links: { type: 'boolean', default: false },
      'links-allow': { type: 'string' },
      'class-audit': { type: 'boolean', default: false },
      'font-sources': { type: 'boolean', default: false },
      'asset-hashes': { type: 'boolean', default: false },
      seo: { type: 'boolean', default: false },
      schema: { type: 'boolean', default: false },
      cookie: { type: 'string' },
      'local-storage': { type: 'string' },
      'dismiss-consent': { type: 'boolean', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      brief: { type: 'boolean', default: false },
      'fail-only': { type: 'boolean', default: false },
      limit: { type: 'string' },
      'text-on': { type: 'string' },
      'bg-tokens': { type: 'string' },
      'storage-state': { type: 'string' },
      'basic-auth': { type: 'string' },
      compare: { type: 'string' },
      pdf: { type: 'boolean', default: false },
      record: { type: 'string' },
      har: { type: 'boolean', default: false },
      coverage: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      suffix: { type: 'string' },
      name: { type: 'string' },
      'visible-only': { type: 'boolean', default: false },
      'fail-on-aa': { type: 'boolean', default: false },
      'fail-on-aaa': { type: 'boolean', default: false },
      pages: { type: 'string' },
      'pages-limit': { type: 'string' },
      urls: { type: 'string' },
      'url-file': { type: 'string' },
      fleet: { type: 'string' },
      locales: { type: 'string' },
      concurrency: { type: 'string' },
      consistency: { type: 'boolean', default: false },
      'i18n-check': { type: 'string' },
      'cat-meta': { type: 'boolean', default: false },
      'max-height': { type: 'string' },
      design: { type: 'boolean', default: false },
      'design-spec': { type: 'string' },
      'diff-report': { type: 'string' },
      fold: { type: 'boolean', default: false },
      micro: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      'serve-dir': { type: 'string' },
      glob: { type: 'string' },
      save: { type: 'string' },
      serve: { type: 'boolean', default: false },
      foreground: { type: 'boolean', default: false },
      'serve-stop': { type: 'boolean', default: false },
      'host-resolver': { type: 'string' },
      delta: { type: 'boolean', default: false },
      suggest: { type: 'boolean', default: false },
      layout: { type: 'boolean', default: false },
      history: { type: 'boolean', default: false },
      'responsive-check': { type: 'boolean', default: false },
      'target-size': { type: 'string' },
      'contrast-limit': { type: 'string' },
      tailwind: { type: 'boolean', default: false },
      guard: { type: 'string' },
      threshold: { type: 'string' },
      components: { type: 'string' },
      bundles: { type: 'boolean', default: false },
      images: { type: 'boolean', default: false },
      compression: { type: 'boolean', default: false },
      'third-party': { type: 'boolean', default: false },
      'cache-audit': { type: 'boolean', default: false },
      'critical-path': { type: 'boolean', default: false },
      'resource-hints': { type: 'boolean', default: false },
      'server-timing': { type: 'boolean', default: false },
      'image-optimizer': { type: 'boolean', default: false },
      budget: { type: 'string' },
      speed: { type: 'boolean', default: false },
      'design-audit': { type: 'boolean', default: false },
      'batch-report': { type: 'boolean', default: false },
      timeout: { type: 'string' },
      mcp: { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    try {
      const pkgPath = resolve(fileURLToPath(import.meta.url), '../../package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      console.log(pkg.version);
    } catch {
      console.log('unknown');
    }
    process.exit(0);
  }

  if (values.serve) {
    await startServer({ foreground: values.foreground ?? false });
    return;
  }

  if (values['serve-stop']) {
    stopServer();
    return;
  }

  if (values.mcp) {
    const { startMcpServer } = await import('./mcp.js');
    await startMcpServer();
    return;
  }

  if (values['cat-meta']) {
    const { readFileSync, existsSync: fileExists } = await import('node:fs');
    const base = values.output ?? DEFAULT_OUTPUT;
    const metaMd = base.replace(/\.(png|jpg|jpeg|pdf)$/, '.meta.md');
    const metaJson = base.replace(/\.(png|jpg|jpeg|pdf)$/, '.meta.json');
    const metaPath = fileExists(metaJson) ? metaJson : fileExists(metaMd) ? metaMd : null;
    if (!metaPath) {
      console.error(`looksy: no meta file found at ${metaMd} or ${metaJson}`);
      process.exit(1);
    }
    process.stdout.write(readFileSync(metaPath, 'utf-8'));
    return;
  }

  // fleet: audit N live URLs as variadic positionals (no zsh comma word-splitting),
  // reusing the persistent --serve browser. Routes through the multi-domain batch.
  // --cdp: every connectOrLaunch below (incl. subcommands) attaches to that browser.
  if (values.cdp) setCdpEndpoint(values.cdp);

  if (positionals[0] === 'fleet') {
    const fleetUrls = positionals.slice(1);
    const fleetConfigPath = values.fleet ? String(values.fleet) : './fleet.yaml';
    const hasFleetConfig = existsSync(fleetConfigPath);
    if (fleetUrls.length === 0 && !values.urls && !values['url-file'] && !hasFleetConfig) {
      console.error(
        'looksy: fleet requires one or more URLs, or a fleet.yaml (e.g. looksy fleet https://a.com https://b.com)',
      );
      process.exit(1);
    }
    const all = configureFleet(fleetUrls, values);
    applyCompoundFlags(values);
    const firstUrl = all[0] ? resolveUrl(all[0]) : 'http://localhost';
    await runCaptureFlow(values, firstUrl, null);
    return;
  }

  // Expand compound shorthand flags before dispatching
  applyCompoundFlags(values);

  // Try subcommands (list, save, diff, batch, validate-theme, fingerprint, history, guard)
  if (await handleSubcommand(values, positionals)) return;

  // Regular capture flow
  const { url, autoServer } = await resolveCaptureUrl(values, positionals);
  await runCaptureFlow(values, url, autoServer);
}

export function applyCompoundFlags(values: Record<string, any>): void {
  // --brief: ≤10-line red-only summary for gate/hook use — implies -q
  if (values.brief) values.quiet = true;

  // --design: shorthand for --full --meta --compact --fonts --css-vars --contrast --suggest
  if (values.design) {
    values.full = true;
    values.meta = true;
    values.compact = true;
    values.fonts = true;
    values['css-vars'] = true;
    values.contrast = true;
    values.suggest = true;
  }

  // --speed: all performance analysis in one flag
  if (values.speed) {
    values.perf = true;
    values.network = true;
    values.coverage = true;
    values.bundles = true;
    values.images = true;
    values.compression = true;
    values['third-party'] = true;
    values['cache-audit'] = true;
    values['critical-path'] = true;
    values['resource-hints'] = true;
    values['server-timing'] = true;
    values['image-optimizer'] = true;
    values.report = true;
    values.compact = true;
  }

  // --design-audit: pre-launch QA — a superset of --design's sidecar (meta, fonts, css-vars)
  if (values['design-audit']) {
    values.full = true;
    values.compact = true;
    values.meta = true;
    values['css-vars'] = true;
    values.contrast = true;
    values.seo = true;
    values.schema = true;
    values.fonts = true;
    values['font-sources'] = true;
    values.suggest = true;
    // Mobile-aware gate: responsive-check runs at 375/768/1440 (touch targets, overflow,
    // tiny text) and — because --contrast is on — also samples contrast per breakpoint,
    // covering the mobile contrast + 44px touch-target rules the desktop pass alone misses.
    values['responsive-check'] = true;
    // Default --design-audit's contrast sample well past typical page element counts so the
    // gate doesn't silently pass on an unchecked remainder; an explicit --contrast-limit wins.
    if (values['contrast-limit'] === undefined) values['contrast-limit'] = '400';
    const auditChecks = 'no generator, self-hosted-fonts, contrast:aa';
    values.check = values.check ? `${values.check}, ${auditChecks}` : auditChecks;
  }

  // A sampled AA/AAA contrast gate that only checks 150 elements isn't a real gate: any
  // --check list containing contrast:aa/contrast:aaa gets the same generous 400-element
  // sample --design-audit uses, unless the caller set --contrast-limit explicitly. Runs
  // after the --design-audit block above so it also covers --design-audit's own
  // auto-appended "contrast:aa" — the undefined-guard keeps this idempotent either way.
  if (typeof values.check === 'string' && values['contrast-limit'] === undefined) {
    const checkItems = values.check.split(',').map((s: string) => s.toLowerCase().trim());
    if (checkItems.includes('contrast:aa') || checkItems.includes('contrast:aaa')) {
      values['contrast-limit'] = '400';
    }
  }
}

interface CaptureUrlResult {
  url: string;
  autoServer: StaticServer | null;
}

/** Resolve the URL to capture, including --html pipe mode, --serve-dir, --watch auto-serve, and local file auto-serve. */
async function resolveCaptureUrl(
  values: Record<string, any>,
  positionals: string[],
): Promise<CaptureUrlResult> {
  let autoServer: StaticServer | null = null;

  if (values.html) {
    const html = await readStdin();
    if (!html) {
      console.error('looksy: --html flag requires piped HTML input');
      process.exit(1);
    }
    return { url: htmlToTempUrl(html), autoServer: null };
  }

  if (values['serve-dir']) {
    const serveDir = resolve(values['serve-dir']);
    if (!existsSync(serveDir)) {
      console.error(`looksy: directory not found: ${values['serve-dir']}`);
      process.exit(1);
    }
    autoServer = await startStaticServer(serveDir);
    let url = autoServer.url;
    if (positionals.length > 0) {
      // Positional becomes a page path relative to served dir
      const pagePath = positionals[0].startsWith('/') ? positionals[0] : `/${positionals[0]}`;
      url = `${autoServer.url}${pagePath}`;
    }
    return { url, autoServer };
  }

  if (positionals.length === 0) {
    // --watch without URL: auto-serve the watched directory
    if (values.watch) {
      const watchDir = resolve(values.watch);
      const indexPath = join(watchDir, 'index.html');
      if (!existsSync(indexPath)) {
        console.error(
          `looksy: --watch requires a URL argument or index.html in the watched directory`,
        );
        process.exit(1);
      }
      autoServer = await startStaticServer(watchDir);
      return { url: `${autoServer.url}/index.html`, autoServer };
    }
    const html = await readStdin();
    if (html) return { url: htmlToTempUrl(html), autoServer: null };
    printHelp();
    process.exit(1);
  }

  const rawUrl = resolveUrl(positionals[0]);
  // Auto-serve local files via HTTP instead of file:// (handles root-relative assets)
  if (rawUrl.startsWith('file://')) {
    const filePath = new URL(rawUrl).pathname;
    const fileDir = dirname(filePath);
    const fileName = basename(filePath);
    autoServer = await startStaticServer(fileDir);
    return { url: `${autoServer.url}/${fileName}`, autoServer };
  }
  return { url: rawUrl, autoServer: null };
}

async function runCaptureFlow(
  values: Record<string, any>,
  url: string,
  autoServer: StaticServer | null,
): Promise<void> {
  const darkMode = values.dark ?? false;
  const fullPage = values.full ?? false;
  // --tailwind implies --meta (utility profile is rendered as part of metadata)
  const meta = (values.meta ?? false) || (values.tailwind ?? false);
  const annotate = values.annotate ?? false;
  const perf = values.perf ?? false;
  // --fragment: piped component/fragment preview — suppress doc-level (lang/canonical) noise
  // in a11y.ts/seo.ts's automatic issue lists. Explicit --check assertions are unaffected.
  const fragment = values.fragment ?? false;
  const a11y = values.a11y ?? false;
  const contrast = values.contrast ?? false;
  const network = values.network ?? false;
  const sections = values.sections ?? false;
  const compact = values.compact ?? false;
  const report = values.report ?? false;
  const check = values.check;
  const audit = values.audit;
  const waitMs = values.wait ? validateNumeric('wait', values.wait) : undefined;
  const selector = values.selector;
  const interact = values.interact;
  const inject = combineInject(values.inject, values.ignore);
  const timeout = values.timeout ? validateNumeric('timeout', values.timeout) : undefined;
  const outputDir = values['output-dir'];
  const filmstrip = values.filmstrip ? validateNumeric('filmstrip', values.filmstrip) : undefined;
  const filmstripScroll = values['filmstrip-scroll']
    ? validateNumeric('filmstrip-scroll', values['filmstrip-scroll'])
    : undefined;
  const format =
    values.format === 'jpeg' || values.format === 'jpg' ? ('jpeg' as const) : ('png' as const);
  const quality = values.quality
    ? (() => {
        const q = validateNumeric('quality', values.quality!);
        if (q < 0 || q > 100) {
          console.error('looksy: --quality must be between 0 and 100');
          process.exit(1);
        }
        return q;
      })()
    : undefined;
  const domStats = values['dom-stats'] ?? false;
  const cssVars = values['css-vars'] ?? false;
  const fonts = values.fonts ?? false;
  const lighthouse = values.lighthouse ?? false;
  const links = values.links ?? false;
  const linksAllow = values['links-allow'];
  const classAudit = values['class-audit'] ?? false;
  const fontSources = values['font-sources'] ?? false;
  const assetHashes = values['asset-hashes'] ?? false;
  const seo = values.seo ?? false;
  const schema = values.schema ?? false;
  const cookie = values.cookie;
  const localStorage = values['local-storage'];
  const dismissConsent = values['dismiss-consent'] ?? false;
  // --limit all → no cap
  const listLimit = values.limit
    ? values.limit === 'all'
      ? Number.MAX_SAFE_INTEGER
      : validateNumeric('limit', values.limit)
    : undefined;
  const storageState = values['storage-state'];
  const basicAuth = values['basic-auth'];
  const compare = values.compare;
  const pdf = values.pdf ?? false;
  const record = values.record ? validateNumeric('record', values.record) : undefined;
  const har = values.har ?? false;
  const coverage = values.coverage ?? false;
  // --batch-report needs the .meta.json sidecar; when the user didn't ask for --json themselves,
  // also keep the .meta.md (agents read md, CI reads json — the naming says which is which).
  const batchReport = values['batch-report'] ?? false;
  const metaMd = batchReport && !values.json;
  if (batchReport) values.json = true;
  const json = values.json ?? false;
  const maxHeight = values['max-height']
    ? validateNumeric('max-height', values['max-height'])
    : undefined;
  const visibleOnly = values['visible-only'] ?? false;
  const failOnAa = values['fail-on-aa'] ?? false;
  const failOnAaa = values['fail-on-aaa'] ?? false;
  const suffix = values.output ? undefined : (values.suffix ?? values.name);
  const designSpec = values['design-spec'];
  const diffReport = values['diff-report'];
  const fold = values.fold ?? false;
  const micro = values.micro ?? false;
  const selectorAll = values.all ?? false;
  const delta = values.delta ?? false;
  const suggest = values.suggest ?? false;
  const layout = values.layout ?? false;
  const history = values.history ?? false;
  const responsiveCheck = values['responsive-check'] ?? false;
  const targetSize = values['target-size'] ? parseInt(values['target-size'], 10) : undefined;
  const contrastLimit = values['contrast-limit']
    ? validateNumeric('contrast-limit', values['contrast-limit'])
    : undefined;
  const tailwind = values.tailwind ?? false;
  const components = values.components;
  const bundles = values.bundles ?? false;
  const imageAudit = values.images ?? false;
  const compressionCheck = values.compression ?? false;
  const thirdParty = values['third-party'] ?? false;
  const cacheAuditFlag = values['cache-audit'] ?? false;
  const criticalPath = values['critical-path'] ?? false;
  const resourceHints = values['resource-hints'] ?? false;
  const serverTimingFlag = values['server-timing'] ?? false;
  const imageOptimizer = values['image-optimizer'] ?? false;
  const budgetFlag = values.budget;
  const hostResolverRule = values['host-resolver'];
  if (hostResolverRule) {
    try {
      parseHostResolverRule(hostResolverRule);
    } catch (err: any) {
      console.error(`looksy: ${err.message}`);
      process.exit(1);
    }
  }
  // An explicit -o/--name/--suffix alongside a text-only mode (--report/--check/--audit
  // with no other visual flag) means the caller wants a PNG at that path — see the
  // --report + --name bug this closes: --report alone is "text-only, no PNG", so a bare
  // --name suffix on it silently produced no file at preview-<name>.png.
  const forceScreenshot = Boolean(values.output || values.suffix || values.name);
  const vp = resolveViewport(values);

  // Shared analysis + capture options — single source of truth for single capture,
  // --sweep, and batch. Keeping these in one object stops new analysis flags from
  // silently missing a code path (the sweep baseConfig had drifted, dropping
  // inject/timeout/selectorAll/maxHeight/designSpec/suggest).
  const commonConfig = {
    url,
    fullPage,
    selector,
    selectorAll,
    waitMs,
    darkMode,
    meta,
    annotate,
    perf,
    interact,
    inject,
    stabilize: !values['no-stabilize'],
    timeout,
    maxHeight,
    fragment,
    a11y,
    contrast,
    network,
    compact,
    report,
    check,
    audit,
    format,
    quality,
    domStats,
    cssVars,
    fonts,
    lighthouse,
    links,
    linksAllow,
    classAudit,
    fontSources,
    assetHashes,
    seo,
    schema,
    cookie,
    localStorage,
    dismissConsent,
    listLimit,
    metaMd,
    brief: values.brief ?? false,
    storageState,
    basicAuth,
    har,
    coverage,
    json,
    visibleOnly,
    designSpec,
    suggest,
    bundles,
    imageAudit,
    compression: compressionCheck,
    thirdParty,
    cacheAudit: cacheAuditFlag,
    criticalPath,
    resourceHints,
    serverTiming: serverTimingFlag,
    imageOptimizer,
    budget: budgetFlag,
    responsiveCheck,
    targetSize,
    tailwind,
    contrastLimit,
    hostResolverRule,
    forceScreenshot,
  };

  const buildConfig = (output: string, vpOverride?: { width: number; height: number }) => ({
    ...commonConfig,
    output,
    ...(vpOverride ?? vp),
    // Single-capture-only options (don't compose with --sweep's per-breakpoint loop).
    sections,
    filmstrip,
    filmstripScroll,
    pdf,
    fold,
    micro,
    diffReport,
    delta,
    layout,
    history,
  });

  const contrastExit = (results: ScreenshotResult[]) => {
    flagFailedChecks(results);
    checkContrastExit(results, failOnAa, failOnAaa);
  };
  const cleanup = () => {
    if (values.html) cleanupTempHtml();
    if (autoServer) autoServer.close();
  };

  // --record mode: special handling
  if (record) {
    const { recordVideo } = await import('./record.js');
    const output = applySuffix(values.output ?? `${LOOKSY_DIR}/preview.webm`, suffix);
    await recordVideo(url, output, {
      duration: record,
      width: vp.width,
      height: vp.height,
      darkMode,
    });
    console.log(output);
    cleanup();
    return;
  }

  // --compare mode
  if (compare) {
    const { compareUrls } = await import('./compare.js');
    const output = applySuffix(values.output ?? DEFAULT_OUTPUT, suffix);
    const result = await compareUrls(url, compare, output, vp);
    console.log(result.diffPath);
    console.log(
      `Changed: ${result.changedPixels}/${result.totalPixels} pixels (${result.changePercent}%)`,
    );

    if (classAudit) {
      const { extractClassAudit, compareClassAudits, formatClassCompare } =
        await import('./class-audit.js');
      await withBrowser(async (cBrowser) => {
        const ctxA = await cBrowser.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        const ctxB = await cBrowser.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        try {
          const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
          await Promise.all([navigateSafe(pageA, url), navigateSafe(pageB, compare)]);
          const [auditA, auditB] = await Promise.all([
            extractClassAudit(pageA),
            extractClassAudit(pageB),
          ]);
          const cmpResult = compareClassAudits(auditA, auditB);
          console.log(formatClassCompare(cmpResult, { compact, urlA: url, urlB: compare }));
        } finally {
          await ctxA.close().catch(() => {});
          await ctxB.close().catch(() => {});
        }
      });
    }

    cleanup();
    return;
  }

  // --watch mode
  if (values.watch) {
    const output = applySuffix(values.output ?? DEFAULT_OUTPUT, suffix);
    const config = buildConfig(output);
    console.log(`looksy: watching ${values.watch} — Ctrl+C to stop`);
    const watcher = startWatch(values.watch, config, (result) => {
      console.log(result.imagePath);
      if (result.metaPath) console.log(result.metaPath);
      if (result.diffPercent) console.log(`  diff: ${result.diffPercent}% changed`);
    });
    process.on('SIGINT', () => {
      watcher.close();
      cleanup();
      process.exit(0);
    });
    await new Promise(() => {});
    return;
  }

  // --sweep mode
  if (values.sweep) {
    const output = applySuffix(values.output ?? DEFAULT_OUTPUT, suffix);
    const sweepWidths = values['sweep-widths'];
    const customBreakpoints = sweepWidths
      ? sweepWidths
          .split(',')
          .map((s: string) => parseInt(s.trim(), 10))
          .filter((n: number) => !isNaN(n))
      : undefined;
    const baseConfig = {
      ...commonConfig,
      // Sweep drives its own viewport per breakpoint; these capture modes don't apply.
      sections: false,
      filmstrip: undefined,
      filmstripScroll: undefined,
      pdf: false,
    };
    const sweep = await responsiveSweep(baseConfig, output, customBreakpoints);
    for (const s of sweep.screenshots) {
      // One line per breakpoint with the number that matters most: horizontal overflow.
      const p = s.pageInfo;
      const over = p ? formatOverflowFlag(p.width, s.width) : '';
      const dims = p ? ` page ${p.width}x${p.height}px${over}` : '';
      const aa = s.contrastFailures ? ` | contrast ${s.contrastFailures.aa} AA fail` : '';
      console.log(`${s.breakpoint}px (${s.label}):${dims}${aa}`);
      if (!values.quiet) console.log(`  ${s.path}`);
      if (s.metaPath && !values.quiet) console.log(`  meta: ${s.metaPath}`);
      if (s.analysisSummaries) for (const line of s.analysisSummaries) console.log(`  ${line}`);
    }
    for (const f of sweep.failures) {
      console.error(`  ✗ ${f.width}px: ${f.error}`);
    }
    if (sweep.failures.length > 0) process.exitCode = 1;
    if (autoServer) autoServer.close();
    return;
  }

  // --responsive-check standalone (not composed with other analysis flags)
  if (
    responsiveCheck &&
    !meta &&
    !contrast &&
    !a11y &&
    !perf &&
    !report &&
    !check &&
    !seo &&
    !schema &&
    !fonts &&
    !fontSources &&
    !suggest &&
    !values['design-audit']
  ) {
    try {
      const result = await runResponsiveCheck(url, undefined, {
        targetSize,
        visibleOnly,
        cookie,
        localStorage,
        dismissConsent,
        timeout,
      });
      console.log(formatResponsiveCheck(result, { compact, limit: listLimit }));
    } finally {
      cleanup();
    }
    return;
  }

  // --components: multi-selector element capture
  if (components) {
    const output = applySuffix(values.output ?? DEFAULT_OUTPUT, suffix);
    const { browser } = await connectOrLaunch();
    try {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await navigateSafe(page, url, { timeout: 30000 });
      if (waitMs) await page.waitForTimeout(waitMs);
      const result = await captureComponents(page, components, output);
      for (const c of result.components) {
        console.log(`  ${c.index}. ${c.selector} [${c.width}x${c.height}] → ${c.path}`);
      }
      if (result.gridPath) console.log(`Grid: ${result.gridPath}`);
      await ctx.close();
    } finally {
      await browser.close();
    }
    cleanup();
    return;
  }

  // --i18n-check: structural comparison of two locale paths
  if (values['i18n-check']) {
    const parts = values['i18n-check']
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);
    if (parts.length !== 2) {
      console.error(
        'looksy: --i18n-check requires exactly 2 comma-separated paths (e.g. "/en/pricing,/de/pricing")',
      );
      process.exit(1);
    }
    const baseUrl = new URL(url);
    const { browser } = await connectOrLaunch();
    let contextA: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let contextB: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    try {
      const [urlA, urlB] = parts.map((p: string) => new URL(p, baseUrl).href);
      contextA = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      contextB = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()]);
      await Promise.all([navigateSafe(pageA, urlA), navigateSafe(pageB, urlB)]);
      const [snapA, snapB] = await Promise.all([
        extractLocaleSnapshot(pageA),
        extractLocaleSnapshot(pageB),
      ]);
      snapA.url = urlA;
      snapB.url = urlB;
      const report = compareLocales(snapA, snapB, { compact });
      console.log(report);
    } finally {
      if (contextA) await contextA.close().catch(() => {});
      if (contextB) await contextB.close().catch(() => {});
      await browser.close();
      if (autoServer) autoServer.close();
    }
    return;
  }

  // --pages / --locales: batch screenshot multiple paths on one domain
  if (values.pages || values.locales) {
    const target = resolveOutputTarget(values.output);
    if (target.dir) {
      mkdirSync(target.dir, { recursive: true });
      values.output = undefined;
    }
    try {
      await runPagesBatch(
        values,
        url,
        buildConfig,
        contrastExit,
        outputDir ?? target.dir,
        format,
        compact,
        batchReport,
        contrast,
      );
    } finally {
      cleanup();
    }
    return;
  }

  // --urls / --url-file (and fleet, which routes through --urls): batch across multiple domains
  if (values.urls || values['url-file']) {
    const target = resolveOutputTarget(values.output);
    if (target.dir) {
      mkdirSync(target.dir, { recursive: true });
      values.output = undefined;
    }
    await runUrlsBatch(
      values,
      buildConfig,
      contrastExit,
      outputDir ?? target.dir,
      format,
      compact,
      batchReport,
      contrast,
    );
    return;
  }

  // Default: single or --multi capture
  try {
    if (values.multi) {
      const rawBase = values.output ?? `${LOOKSY_DIR}/preview`;
      const base = suffix ? `${rawBase}-${suffix.replace(/[^a-zA-Z0-9_-]/g, '-')}` : rawBase;
      const ext = format === 'jpeg' ? '.jpg' : '.png';

      const { browser } = await connectOrLaunch({ hostResolverRule });
      try {
        const [desktop, mobile] = await Promise.all([
          screenshot({
            ...buildConfig(`${base}-desktop${ext}`, viewports.desktop),
            browser,
            historyLabel: 'desktop',
          }),
          screenshot({
            ...buildConfig(`${base}-mobile${ext}`, viewports.mobile),
            browser,
            historyLabel: 'mobile',
          }),
        ]);
        if (values.brief) {
          printBrief([
            { url: `${url} (desktop)`, result: desktop },
            { url: `${url} (mobile)`, result: mobile },
          ]);
        } else {
          printResult(desktop, { quiet: values.quiet });
          printResult(mobile, { quiet: values.quiet });
        }
        contrastExit([desktop, mobile]);
      } finally {
        await browser.close();
      }
    } else {
      const output = applySuffix(
        values.output ?? (format === 'jpeg' ? `${LOOKSY_DIR}/preview.jpg` : DEFAULT_OUTPUT),
        suffix,
      );
      const result = await screenshot(buildConfig(output));
      if (values.brief) {
        printBrief([{ url, result }]);
      } else {
        printResult(result, { quiet: values.quiet });
      }

      if (values['diff-inline'] && !values.brief) {
        const beforePath = resolve(values['diff-inline']);
        const diffOutput = output.replace(/\.(png|jpg|jpeg)$/, '-diff.png');
        const diff = await diffInline(beforePath, result.imagePath, diffOutput);
        console.log(diff.diffPath);
        console.log(
          `Changed: ${diff.changedPixels}/${diff.totalPixels} pixels (${diff.changePercent}%)`,
        );
      }

      contrastExit([result]);

      if (result.budgetResults && !result.budgetResults.allPassed) {
        console.error(`Budget: ${result.budgetResults.failCount} check(s) failed`);
        process.exit(1);
      }
    }
  } finally {
    cleanup();
  }
}

async function runPagesBatch(
  values: Record<string, any>,
  url: string,
  buildConfig: (output: string, vpOverride?: { width: number; height: number }) => any,
  contrastExit: (results: ScreenshotResult[]) => void,
  outputDir: string | undefined,
  format: 'jpeg' | 'png',
  compact: boolean,
  batchReport: boolean,
  contrast: boolean,
): Promise<void> {
  const pagesLimit = values['pages-limit']
    ? validateNumeric('pages-limit', values['pages-limit'])
    : undefined;

  let paths: string[];
  if (values.pages === '@sitemap') {
    const baseUrlForSitemap = new URL(url);
    try {
      paths = await fetchSitemapPaths(baseUrlForSitemap.origin, { limit: pagesLimit });
    } catch (err: any) {
      console.error(`looksy: ${err.message}`);
      process.exit(1);
    }
    if (paths.length === 0) {
      console.error('looksy: --pages @sitemap found no <url> entries');
      process.exit(1);
    }
  } else {
    paths = values.pages
      ? values.pages
          .split(',')
          .map((p: string) => p.trim())
          .filter(Boolean)
      : ['/'];
  }

  // --locales: cross-product locales × paths
  if (values.locales) {
    const locales = values.locales
      .split(',')
      .map((l: string) => l.trim())
      .filter(Boolean);
    if (locales.length === 0) {
      console.error('looksy: --locales requires comma-separated locale codes (e.g. "en,de,fr")');
      process.exit(1);
    }
    const expanded: string[] = [];
    for (const locale of locales) {
      for (const p of paths) {
        const clean = p === '/' ? '' : p.replace(/^\//, '');
        expanded.push(`/${locale}/${clean}`.replace(/\/+$/, '') || `/${locale}`);
      }
    }
    paths = expanded;
  }

  // --pages-limit truncates the final expanded list regardless of source (manual list,
  // @sitemap, or @sitemap × --locales) — simplest reading of "cap how many pages run".
  if (pagesLimit !== undefined) {
    paths = paths.slice(0, pagesLimit);
  }

  if (paths.length === 0) {
    console.error('looksy: --pages requires comma-separated paths (e.g. "/,/pricing,/contact")');
    process.exit(1);
  }

  const baseUrl = new URL(url);
  const { browser } = await connectOrLaunch({ hostResolverRule: values['host-resolver'] });

  const heavyMode = values.design || values.full || values.speed;
  const concurrencyLimit = values.concurrency
    ? validateNumeric('concurrency', values.concurrency)
    : heavyMode
      ? 3
      : Infinity;

  try {
    const settled = await pMapSettled(
      paths,
      async (pagePath: string) => {
        const pageUrl = new URL(pagePath, baseUrl).href;
        const pageSuffix =
          pagePath === '/'
            ? 'index'
            : pagePath
                .replace(/^\//, '')
                .replace(/\/+$/, '')
                .replace(/\//g, '-')
                .replace(/[^a-zA-Z0-9_-]/g, '-');
        const baseOutput = outputDir
          ? join(outputDir, `preview-${pageSuffix}${format === 'jpeg' ? '.jpg' : '.png'}`)
          : applySuffix(
              values.output ?? (format === 'jpeg' ? `${LOOKSY_DIR}/preview.jpg` : DEFAULT_OUTPUT),
              pageSuffix,
            );
        const consistency = values.consistency ?? false;
        const result = await screenshot({
          ...buildConfig(baseOutput),
          url: pageUrl,
          browser,
          consistency,
        });
        return { result, url: pageUrl };
      },
      concurrencyLimit,
    );
    const pagedResults: Array<{ result: ScreenshotResult; url: string }> = [];
    const failures: Array<{ target: string; message: string }> = [];
    settled.forEach((s, i) => {
      if (s.ok) pagedResults.push(s.value);
      else failures.push({ target: new URL(paths[i], baseUrl).href, message: s.error.message });
    });
    const results = pagedResults.map((p) => p.result);
    if (values.brief) {
      const briefEntries = [
        ...pagedResults,
        ...failures.map((f) => ({ url: f.target, result: { imagePath: '', error: f.message } })),
      ];
      printBrief(briefEntries);
    } else {
      for (const r of results) {
        if (values['fail-only'] && !isRed(r)) continue;
        printResult(r, { quiet: values.quiet });
      }
      if (results.length > 1)
        printBatchSummary(pagedResults, 'pages', { failOnly: values['fail-only'] });

      if (values.consistency && results.length >= 2) {
        const snapshots = results.filter((r) => r.pageSnapshot).map((r) => r.pageSnapshot!);
        if (snapshots.length >= 2) {
          console.log(compareSnapshots(snapshots, { compact }));
        }
      }

      if (contrast && results.length > 1) {
        printContrastSummary(pagedResults, 'pages');
      }
    }
    printBatchFailures(failures, paths.length, values.brief);

    if (batchReport) {
      const { extractBatchRow, formatBatchReport } = await import('./batch-report.js');
      const { writeFileSync } = await import('node:fs');
      const rows = pagedResults.map(({ result, url: pageUrl }) => extractBatchRow(pageUrl, result));
      const reportText = formatBatchReport(rows, { baseUrl: url }) + failuresAppendix(failures);
      const reportDir = outputDir ?? LOOKSY_DIR;
      const reportPath = join(reportDir, 'batch-report.md');
      writeFileSync(reportPath, reportText, 'utf-8');
      if (!values.brief) console.log(`\nBatch report: ${reportPath}`);
    }

    contrastExit(results);
  } finally {
    await browser.close();
  }
}

async function runUrlsBatch(
  values: Record<string, any>,
  buildConfig: (output: string, vpOverride?: { width: number; height: number }) => any,
  contrastExit: (results: ScreenshotResult[]) => void,
  outputDir: string | undefined,
  format: 'jpeg' | 'png',
  compact: boolean,
  batchReport: boolean,
  contrast: boolean,
): Promise<void> {
  let urlList: string[] = [];
  if (values['url-file']) {
    const { readFileSync } = await import('node:fs');
    const filePath = resolve(values['url-file']);
    if (!existsSync(filePath)) {
      console.error(`looksy: --url-file not found: ${filePath}`);
      process.exit(1);
    }
    urlList = readFileSync(filePath, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  if (values.urls) {
    urlList = urlList.concat(
      values.urls
        .split(',')
        .map((u: string) => u.trim())
        .filter(Boolean),
    );
  }

  if (urlList.length === 0) {
    console.error('looksy: --urls / --url-file requires at least one URL');
    process.exit(1);
  }

  urlList = urlList.map((u) => resolveUrl(u));

  const { browser } = await connectOrLaunch({ hostResolverRule: values['host-resolver'] });
  const heavyMode = values.design || values.full || values.speed;
  const concurrencyLimit = values.concurrency
    ? validateNumeric('concurrency', values.concurrency)
    : heavyMode
      ? 3
      : Infinity;

  try {
    const settled = await pMapSettled(
      urlList,
      async (pageUrl) => {
        const safeSuffix = urlToOutputSuffix(pageUrl);
        const baseOutput = outputDir
          ? join(outputDir, `preview-${safeSuffix}${format === 'jpeg' ? '.jpg' : '.png'}`)
          : applySuffix(
              values.output ?? (format === 'jpeg' ? `${LOOKSY_DIR}/preview.jpg` : DEFAULT_OUTPUT),
              safeSuffix,
            );
        const consistency = values.consistency ?? false;
        const result = await screenshot({
          ...buildConfig(baseOutput),
          url: pageUrl,
          browser,
          consistency,
        });
        return { result, url: pageUrl };
      },
      concurrencyLimit,
    );
    const batchResults: Array<{ result: ScreenshotResult; url: string }> = [];
    const failures: Array<{ target: string; message: string }> = [];
    settled.forEach((s, i) => {
      if (s.ok) batchResults.push(s.value);
      else failures.push({ target: urlList[i], message: s.error.message });
    });
    const results = batchResults.map((p) => p.result);
    if (values.brief) {
      const briefEntries = [
        ...batchResults,
        ...failures.map((f) => ({ url: f.target, result: { imagePath: '', error: f.message } })),
      ];
      printBrief(briefEntries);
    } else {
      for (const r of results) {
        if (values['fail-only'] && !isRed(r)) continue;
        printResult(r, { quiet: values.quiet });
      }
      if (results.length > 1)
        printBatchSummary(batchResults, 'URLs', { failOnly: values['fail-only'] });

      if (values.consistency && results.length >= 2) {
        const snapshots = results.filter((r) => r.pageSnapshot).map((r) => r.pageSnapshot!);
        if (snapshots.length >= 2) {
          console.log(compareSnapshots(snapshots, { compact }));
        }
      }

      if (contrast && results.length > 1) {
        printContrastSummary(batchResults, 'URLs');
      }
    }
    printBatchFailures(failures, urlList.length, values.brief);

    if (batchReport) {
      const { extractBatchRow, formatBatchReport } = await import('./batch-report.js');
      const { writeFileSync } = await import('node:fs');
      const rows = batchResults.map(({ result, url: pageUrl }) => extractBatchRow(pageUrl, result));
      const reportText =
        formatBatchReport(rows, { baseUrl: 'multi-domain' }) + failuresAppendix(failures);
      const reportDir = outputDir ?? LOOKSY_DIR;
      const reportPath = join(reportDir, 'batch-report.md');
      writeFileSync(reportPath, reportText, 'utf-8');
      if (!values.brief) console.log(`\nBatch report: ${reportPath}`);
    }

    contrastExit(results);
  } finally {
    await browser.close();
  }
}

/**
 * Closing per-target table for batch/fleet runs: one line per URL with the signals an agent
 * scans for (title, page size + hscroll flag, AA fails, suggestion count) — so 10 URLs don't
 * require eyeballing 60 lines of per-URL output to find the two pages with findings.
 */
/**
 * Pure formatter for the Batch summary block. `failOnly`: list only red entries (per the shared
 * --brief/--fail-only redness definition), plus a trailing `N clean` line — always shown when
 * failOnly is set, even when N is 0 or N is everything, so the reader always knows the run
 * completed rather than wondering why nothing printed.
 */
export function formatBatchSummary(
  entries: Array<{ result: ScreenshotResult; url: string }>,
  label: string,
  opts: { failOnly?: boolean } = {},
): string[] {
  const failOnly = opts.failOnly ?? false;
  const shown = failOnly ? entries.filter(({ result: r }) => isRed(r)) : entries;
  const lines: string[] = [`\n--- Batch: ${entries.length} ${label} ---`];
  for (const { result: r, url } of shown) {
    const p = r.pageInfo;
    const over = p?.viewportWidth ? formatOverflowFlag(p.width, p.viewportWidth) : '';
    const dims = p ? `${p.width}x${p.height}px${over}` : '?';
    const title = p?.title ? ` "${p.title}"` : '';
    const aa = r.contrastFailures ? ` | AA fails: ${r.contrastFailures.aa}` : '';
    const nSuggest = r.suggestText ? (r.suggestText.match(/^\d+\. \[/gm) || []).length : undefined;
    const sug = nSuggest !== undefined ? ` | suggestions: ${nSuggest}` : '';
    const checks = r.checkResults
      ? ` | checks: ${(r.checkResults.match(/\[FAIL\]/g) || []).length} fail`
      : '';
    const timing = r.elapsedMs ? ` (${(r.elapsedMs / 1000).toFixed(1)}s)` : '';
    lines.push(`  ${url}`);
    lines.push(`    ${dims}${title}${aa}${sug}${checks}${timing} → ${r.imagePath}`);
  }
  if (failOnly) lines.push(`  ${entries.length - shown.length} clean`);
  return lines;
}

function printBatchSummary(
  entries: Array<{ result: ScreenshotResult; url: string }>,
  label: string,
  opts?: { failOnly?: boolean },
): void {
  for (const line of formatBatchSummary(entries, label, opts)) console.log(line);
}

/** `--brief`: print the red-only lines; any ✗ line means the run failed (exit 1) — gates/hooks rely on it. */
function printBrief(entries: Parameters<typeof formatBrief>[0]): void {
  for (const line of formatBrief(entries)) console.log(line);
  if (briefIsRed(entries)) process.exitCode = 1;
}

/** Report failed batch targets to stderr and mark the run as failed (exit 1). */
function printBatchFailures(
  failures: Array<{ target: string; message: string }>,
  total: number,
  brief = false,
): void {
  if (failures.length === 0) return;
  // --brief already printed each failure as a ✗ line — only the exit code is still owed.
  if (!brief) {
    console.error(`\n--- ${failures.length} of ${total} targets failed ---`);
    for (const f of failures) console.error(`  ✗ ${f.target}: ${f.message}`);
  }
  process.exitCode = 1;
}

/** Markdown appendix listing failed targets, appended to batch-report.md. */
function failuresAppendix(failures: Array<{ target: string; message: string }>): string {
  if (failures.length === 0) return '';
  return `\n## Failed targets\n\n${failures.map((f) => `- ${f.target} — ${f.message}`).join('\n')}\n`;
}

/** Pure formatter for the Contrast Summary block: prints the source URL, not the PNG path. */
export function formatContrastSummary(
  entries: Array<{ result: ScreenshotResult; url: string }>,
  label: string,
): string[] {
  const lines: string[] = [];
  const allAaFails = entries.reduce((sum, e) => sum + (e.result.contrastFailures?.aa ?? 0), 0);
  const allAaaFails = entries.reduce((sum, e) => sum + (e.result.contrastFailures?.aaa ?? 0), 0);
  lines.push(`\n--- Contrast Summary: ${entries.length} ${label} ---`);
  lines.push(`  AA failures: ${allAaFails} total | AAA failures: ${allAaaFails} total`);
  for (const { result: r, url } of entries) {
    if (r.contrastFailures && (r.contrastFailures.aa > 0 || r.contrastFailures.aaa > 0)) {
      lines.push(`  ${url}: ${r.contrastFailures.aa} AA, ${r.contrastFailures.aaa} AAA`);
    }
  }
  return lines;
}

function printContrastSummary(
  entries: Array<{ result: ScreenshotResult; url: string }>,
  label: string,
): void {
  for (const line of formatContrastSummary(entries, label)) console.log(line);
}

main().catch((err: Error) => {
  console.error(`looksy: ${err.message}`);
  process.exit(1);
});
