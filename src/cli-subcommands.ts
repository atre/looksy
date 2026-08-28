import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { screenshot, type ScreenshotResult } from './screenshot.js';
import { saveBaseline, diffBaseline, diffFiles, listBaselines } from './diff.js';
import { startStaticServer, findFiles, type StaticServer } from './static-server.js';
import {
  captureSemanticSnapshot,
  saveSemanticBaseline,
  loadSemanticBaseline,
} from './diff-report.js';
import { attributeDiff, type Region } from './diff-attribution.js';
import { listHistory, formatHistory } from './history.js';
import { connectOrLaunch, withBrowser } from './server.js';
import { navigateSafe } from './navigate.js';
import { pMapSettled, LOOKSY_DIR } from './utils.js';
import {
  validateNumeric,
  validateFloat,
  resolveUrl,
  resolveViewport,
  applySuffix,
  combineInject,
} from './cli-utils.js';
import { checkContrastExit, printResult } from './cli-output.js';

const DEFAULT_OUTPUT = `${LOOKSY_DIR}/preview.png`;

type Values = Record<string, any>;

/**
 * Dispatch a subcommand. Returns true if a subcommand was recognized and handled
 * (caller should short-circuit). Returns false to fall through to regular capture flow.
 */
export async function handleSubcommand(values: Values, positionals: string[]): Promise<boolean> {
  const subcommand = positionals[0];

  if (subcommand === 'list') {
    await listSubcommand();
    return true;
  }

  if (subcommand === 'save') {
    await saveSubcommand(values, positionals);
    return true;
  }

  if (subcommand === 'diff') {
    await diffSubcommand(values, positionals);
    return true;
  }

  if (subcommand === 'batch') {
    await batchSubcommand(values, positionals);
    return true;
  }

  if (subcommand === 'validate-theme') {
    await validateThemeSubcommand(values, positionals);
    return true;
  }

  if (subcommand === 'fingerprint') {
    await fingerprintSubcommand(values, positionals);
    return true;
  }

  if (subcommand === 'history') {
    await historySubcommand(positionals);
    return true;
  }

  // --guard works as both subcommand and flag
  if (subcommand === 'guard' || values.guard) {
    await guardSubcommand(values, positionals);
    return true;
  }

  return false;
}

async function listSubcommand(): Promise<void> {
  const baselines = listBaselines();
  if (baselines.length === 0) {
    console.log('No baselines saved. Use: looksy save <url> <name>');
  } else {
    console.log('Saved baselines:');
    for (const b of baselines) console.log(`  - ${b}`);
  }
}

async function saveSubcommand(values: Values, positionals: string[]): Promise<void> {
  const urlArg = positionals[1];
  const name = positionals[2];
  if (!urlArg || !name) {
    console.error('Usage: looksy save <url> <name>');
    process.exit(1);
  }
  const url = resolveUrl(urlArg);
  const vp = resolveViewport(values);
  const result = await screenshot({
    url,
    output: DEFAULT_OUTPUT,
    ...vp,
    fullPage: values.full ?? false,
    selector: values.selector,
    waitMs: values.wait ? validateNumeric('wait', values.wait) : undefined,
    darkMode: values.dark ?? false,
    inject: combineInject(values.inject, values.ignore),
    cookie: values.cookie,
    localStorage: values['local-storage'],
    dismissConsent: values['dismiss-consent'] ?? false,
  });
  const saved = saveBaseline(result.imagePath, name);
  console.log(`Baseline "${name}" saved: ${saved}`);

  // Also save semantic snapshot for --diff-report (withBrowser guarantees the --serve
  // connection is released — the old owned-gated close left `save` hanging forever).
  try {
    await withBrowser(async (snapBrowser) => {
      const snapPage = await snapBrowser.newPage();
      try {
        await navigateSafe(snapPage, url);
        const snapshot = await captureSemanticSnapshot(snapPage);
        saveSemanticBaseline(snapshot, name);
      } finally {
        await snapPage.close().catch(() => {});
      }
    });
  } catch {
    /* semantic snapshot is best-effort */
  }
}

/**
 * Best-effort diff→element attribution: map changed-pixel regions to the
 * elements they cover and print style deltas vs the semantic baseline (when
 * one exists from `looksy save`). Never fails the surrounding command.
 */
async function printChangedElements(
  regions: Region[] | undefined,
  baselineName: string,
  url: string,
): Promise<void> {
  if (!regions || regions.length === 0) return;
  try {
    let baselineElements: Parameters<typeof attributeDiff>[1] = [];
    try {
      baselineElements = loadSemanticBaseline(baselineName).elements ?? [];
    } catch {
      /* no semantic baseline — attribute against current elements only */
    }
    const current = await withBrowser(async (browser) => {
      const page = await browser.newPage();
      try {
        await navigateSafe(page, url);
        return await captureSemanticSnapshot(page);
      } finally {
        await page.close().catch(() => {});
      }
    });
    const attributions = attributeDiff(regions, baselineElements, current.elements ?? []);
    if (attributions.length === 0) return;
    console.log('\nChanged elements:');
    for (const a of attributions.slice(0, 8)) {
      console.log(`  ${a.selector} (${a.tag}) — ${a.overlapPct}% of changed area`);
      for (const d of a.styleDeltas ?? []) {
        console.log(`    ${d.prop}: ${d.before} → ${d.after}`);
      }
    }
  } catch {
    /* attribution is additive — the pixel diff above already told the truth */
  }
}

async function diffSubcommand(values: Values, positionals: string[]): Promise<void> {
  const arg1 = positionals[1];
  const arg2 = positionals[2];
  if (!arg1 || !arg2) {
    console.error('Usage: looksy diff <url> <name>  or  looksy diff <before.png> <after.png>');
    process.exit(1);
  }

  // File-to-file mode: both args are image file paths
  const isFileDiff = /\.(png|jpg|jpeg)$/i.test(arg1) && /\.(png|jpg|jpeg)$/i.test(arg2);
  if (isFileDiff) {
    const diffOutput = values.output ?? `${LOOKSY_DIR}/diff.png`;
    const diff = await diffFiles(resolve(arg1), resolve(arg2), diffOutput);
    console.log(diff.diffPath);
    console.log(
      `Changed: ${diff.changedPixels}/${diff.totalPixels} pixels (${diff.changePercent}%)`,
    );
    return;
  }

  // URL + baseline name mode
  const url = resolveUrl(arg1);
  const vp = resolveViewport(values);
  const result = await screenshot({
    url,
    output: DEFAULT_OUTPUT,
    ...vp,
    fullPage: values.full ?? false,
    selector: values.selector,
    waitMs: values.wait ? validateNumeric('wait', values.wait) : undefined,
    darkMode: values.dark ?? false,
    inject: combineInject(values.inject, values.ignore),
    cookie: values.cookie,
    localStorage: values['local-storage'],
    dismissConsent: values['dismiss-consent'] ?? false,
  });
  const diffOutput = values.output ?? `${LOOKSY_DIR}/diff.png`;
  const diff = await diffBaseline(result.imagePath, arg2, diffOutput, { collectRegions: true });
  console.log(diff.diffPath);
  console.log(`Changed: ${diff.changedPixels}/${diff.totalPixels} pixels (${diff.changePercent}%)`);
  if (parseFloat(diff.changePercent) > 0) {
    await printChangedElements(diff.regions, arg2, url);
  }
}

async function batchSubcommand(values: Values, positionals: string[]): Promise<void> {
  const batchDir = positionals[1];
  if (!batchDir) {
    console.error('Usage: looksy batch <dir> --glob "*/index.html" [options]');
    process.exit(1);
  }
  const absDir = resolve(batchDir);
  if (!existsSync(absDir)) {
    console.error(`looksy: directory not found: ${batchDir}`);
    process.exit(1);
  }
  const globPattern = values.glob ?? '*/index.html';
  const files = findFiles(absDir, globPattern);
  if (files.length === 0) {
    console.error(`looksy: no files matching "${globPattern}" in ${batchDir}`);
    process.exit(1);
  }
  console.log(`looksy batch: ${files.length} file(s) matching "${globPattern}" in ${batchDir}`);

  const vp = resolveViewport(values);
  const format =
    values.format === 'jpeg' || values.format === 'jpg' ? ('jpeg' as const) : ('png' as const);
  const compact = values.compact ?? false;
  const failOnAa = values['fail-on-aa'] ?? false;
  const failOnAaa = values['fail-on-aaa'] ?? false;
  const suffix = values.output ? undefined : (values.suffix ?? values.name);

  // Group files by parent directory for serving
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(file);
  }

  const { browser } = await connectOrLaunch();
  const allResults: ScreenshotResult[] = [];
  const batchFailures: Array<{ target: string; message: string }> = [];

  try {
    for (const [subDir, groupFiles] of groups) {
      const servePath = resolve(absDir, subDir);
      const server = await startStaticServer(servePath);

      try {
        const batchHeavy = values.design || values.full || values.speed;
        const batchConcurrency = values.concurrency
          ? validateNumeric('concurrency', values.concurrency)
          : batchHeavy
            ? 3
            : Infinity;

        const settled = await pMapSettled(
          groupFiles,
          async (file) => {
            const fileName = file.split('/').pop()!;
            const pageUrl = `${server.url}/${fileName}`;
            // Derive suffix from directory/file path
            const label =
              subDir === '.' ? fileName.replace(/\.html?$/i, '') : subDir.replace(/\//g, '-');
            const pageSuffix = suffix ? `${suffix}-${label}` : label;
            const output = values['output-dir']
              ? join(
                  values['output-dir'],
                  `preview-${pageSuffix}${format === 'jpeg' ? '.jpg' : '.png'}`,
                )
              : applySuffix(
                  values.output ??
                    (format === 'jpeg' ? `${LOOKSY_DIR}/preview.jpg` : DEFAULT_OUTPUT),
                  pageSuffix,
                );

            return screenshot({
              url: pageUrl,
              output,
              ...vp,
              fullPage: values.full ?? false,
              selector: values.selector,
              waitMs: values.wait ? validateNumeric('wait', values.wait) : undefined,
              darkMode: values.dark ?? false,
              meta: values.meta ?? false,
              annotate: values.annotate ?? false,
              perf: values.perf ?? false,
              interact: values.interact,
              inject: values.inject,
              timeout: values.timeout ? validateNumeric('timeout', values.timeout) : undefined,
              a11y: values.a11y ?? false,
              contrast: values.contrast ?? false,
              network: values.network ?? false,
              sections: values.sections ?? false,
              compact,
              report: values.report ?? false,
              check: values.check,
              audit: values.audit,
              format,
              quality: values.quality ? validateNumeric('quality', values.quality) : undefined,
              domStats: values['dom-stats'] ?? false,
              cssVars: values['css-vars'] ?? false,
              fonts: values.fonts ?? false,
              lighthouse: values.lighthouse ?? false,
              links: values.links ?? false,
              classAudit: values['class-audit'] ?? false,
              fontSources: values['font-sources'] ?? false,
              assetHashes: values['asset-hashes'] ?? false,
              seo: values.seo ?? false,
              schema: values.schema ?? false,
              cookie: values.cookie,
              storageState: values['storage-state'],
              basicAuth: values['basic-auth'],
              pdf: values.pdf ?? false,
              har: values.har ?? false,
              coverage: values.coverage ?? false,
              json: values.json ?? false,
              maxHeight: values['max-height']
                ? validateNumeric('max-height', values['max-height'])
                : undefined,
              visibleOnly: values['visible-only'] ?? false,
              browser,
            });
          },
          batchConcurrency,
        );
        settled.forEach((s, i) => {
          if (s.ok) {
            printResult(s.value);
            allResults.push(s.value);
          } else {
            batchFailures.push({ target: groupFiles[i], message: s.error.message });
          }
        });
      } finally {
        server.close();
      }
    }

    if (batchFailures.length > 0) {
      console.error(`\n--- ${batchFailures.length} of ${files.length} files failed ---`);
      for (const f of batchFailures) console.error(`  ✗ ${f.target}: ${f.message}`);
      process.exitCode = 1;
    }

    if (allResults.length > 1) {
      console.log(`\n--- Batch: ${allResults.length} files ---`);
      for (const r of allResults) {
        const p = r.pageInfo;
        const dims = p ? `${p.width}x${p.height}px` : '?';
        const title = p?.title ? ` "${p.title}"` : '';
        const timing = r.elapsedMs ? ` (${(r.elapsedMs / 1000).toFixed(1)}s)` : '';
        const meta = r.metaPath ? ' +meta' : '';
        console.log(`  ${dims}${title}${timing}${meta} → ${r.imagePath}`);
      }
    }

    if ((values.contrast ?? false) && allResults.length > 1) {
      const allAaFails = allResults.reduce((sum, r) => sum + (r.contrastFailures?.aa ?? 0), 0);
      const allAaaFails = allResults.reduce((sum, r) => sum + (r.contrastFailures?.aaa ?? 0), 0);
      console.log(`\n--- Contrast Summary: ${allResults.length} files ---`);
      console.log(`  AA failures: ${allAaFails} total | AAA failures: ${allAaaFails} total`);
      for (const r of allResults) {
        if (r.contrastFailures && (r.contrastFailures.aa > 0 || r.contrastFailures.aaa > 0)) {
          console.log(
            `  ${r.imagePath}: ${r.contrastFailures.aa} AA, ${r.contrastFailures.aaa} AAA`,
          );
        }
      }
    }

    checkContrastExit(allResults, failOnAa, failOnAaa);
  } finally {
    await browser.close();
  }
}

async function validateThemeSubcommand(values: Values, positionals: string[]): Promise<void> {
  const configPath = positionals[1];
  if (!configPath) {
    console.error(
      'Usage: looksy validate-theme <config.json|globals.css> [--text-on fg,fg2 [--bg-tokens bg,bg2]] [--compact] [--fail-on-aa]',
    );
    process.exit(1);
  }
  const absPath = resolve(configPath);
  if (!existsSync(absPath)) {
    console.error(`looksy: file not found: ${configPath}`);
    process.exit(1);
  }
  const { runThemeValidation } = await import('./validate-theme.js');
  const compact = values.compact ?? false;
  const splitList = (v: unknown): string[] | undefined =>
    typeof v === 'string' && v.trim() ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
  const { text, aaFailures } = runThemeValidation(absPath, {
    compact,
    textOn: splitList(values['text-on']),
    bgTokens: splitList(values['bg-tokens']),
  });
  console.log(text);
  if ((values['fail-on-aa'] ?? false) && aaFailures > 0) process.exit(1);
}

async function fingerprintSubcommand(values: Values, positionals: string[]): Promise<void> {
  const action = positionals[1];

  if (action === 'list') {
    const { listFingerprints } = await import('./fingerprint.js');
    const fps = listFingerprints();
    if (fps.length === 0) {
      console.log('No fingerprints saved. Use: looksy fingerprint collect <url> --save <name>');
    } else {
      console.log(`Saved fingerprints:\n${fps.map((f) => `  ${f}`).join('\n')}`);
    }
    return;
  }

  if (action === 'collect') {
    await fingerprintCollect(values, positionals);
    return;
  }

  if (action === 'compare') {
    await fingerprintCompare(values, positionals);
    return;
  }

  if (action === 'collect-batch') {
    await fingerprintCollectBatch(values);
    return;
  }

  if (action === 'diff') {
    await fingerprintDiff(values, positionals);
    return;
  }

  console.error('Usage: looksy fingerprint <collect|collect-batch|compare|diff|list> [args]');
  process.exit(1);
}

async function fingerprintCollect(values: Values, positionals: string[]): Promise<void> {
  const urlArg = positionals[2];
  const saveName = values.save;
  if (!saveName || (!urlArg && !values['serve-dir'])) {
    console.error(
      'Usage: looksy fingerprint collect <url> --save <name>\n       looksy fingerprint collect --serve-dir <dir> --save <name>',
    );
    process.exit(1);
  }
  const { collectFingerprint, saveFingerprint } = await import('./fingerprint.js');

  let collUrl: string;
  let fpServer: StaticServer | null = null;
  if (values['serve-dir']) {
    const serveDir = resolve(values['serve-dir']);
    if (!existsSync(serveDir)) {
      console.error(`looksy: directory not found: ${values['serve-dir']}`);
      process.exit(1);
    }
    fpServer = await startStaticServer(serveDir);
    collUrl = fpServer.url;
    if (urlArg) {
      const pagePath = urlArg.startsWith('/') ? urlArg : `/${urlArg}`;
      collUrl = `${fpServer.url}${pagePath}`;
    }
  } else {
    collUrl = resolveUrl(urlArg!);
  }

  const { browser } = await connectOrLaunch();
  let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
  try {
    page = await browser.newPage();
    await navigateSafe(page, collUrl, { timeout: 30000 });
    const fp = await collectFingerprint(page, collUrl);
    const dest = saveFingerprint(fp, saveName);
    console.log(`Fingerprint "${saveName}" saved: ${dest}`);
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
    if (fpServer) fpServer.close();
  }
}

async function fingerprintCompare(values: Values, positionals: string[]): Promise<void> {
  const names = positionals.slice(2);
  if (names.length < 2) {
    console.error('Usage: looksy fingerprint compare <name1> <name2> [name3...]');
    process.exit(1);
  }
  const { loadFingerprint, compareFingerprints, formatFingerprintCompare, formatSimilarityMatrix } =
    await import('./fingerprint.js');
  const compact = values.compact ?? false;
  const fingerprints = names.map((n) => loadFingerprint(n));

  if (names.length === 2) {
    const result = compareFingerprints(fingerprints[0], fingerprints[1], names[0], names[1]);
    console.log(formatFingerprintCompare(result, { compact }));
    return;
  }

  console.log(formatSimilarityMatrix(fingerprints, names));
  // Also print detailed comparison for high-risk pairs
  if (compact) return;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const result = compareFingerprints(fingerprints[i], fingerprints[j], names[i], names[j]);
      if (result.overall >= 50) {
        console.log(formatFingerprintCompare(result));
      }
    }
  }
}

async function fingerprintCollectBatch(values: Values): Promise<void> {
  const serveDir = values['serve-dir'];
  if (!serveDir) {
    console.error(
      'Usage: looksy fingerprint collect-batch --serve-dir <dir> [--glob "*/index.html"]',
    );
    process.exit(1);
  }
  const absDir = resolve(serveDir);
  if (!existsSync(absDir)) {
    console.error(`looksy: directory not found: ${serveDir}`);
    process.exit(1);
  }
  const globPattern = values.glob ?? '*/index.html';
  const files = findFiles(absDir, globPattern);
  if (files.length === 0) {
    console.error(`looksy: no files matching "${globPattern}" in ${serveDir}`);
    process.exit(1);
  }
  console.log(
    `looksy fingerprint collect-batch: ${files.length} file(s) matching "${globPattern}"`,
  );

  const { collectFingerprint, saveFingerprint } = await import('./fingerprint.js');
  const { browser } = await connectOrLaunch();
  const collected: string[] = [];

  try {
    const groups = new Map<string, string[]>();
    for (const file of files) {
      const parts = file.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(file);
    }

    for (const [subDir, groupFiles] of groups) {
      const servePath = resolve(absDir, subDir);
      const server = await startStaticServer(servePath);

      try {
        for (const file of groupFiles) {
          const fileName = file.split('/').pop()!;
          const pageUrl = `${server.url}/${fileName}`;
          const fpName =
            subDir === '.' ? fileName.replace(/\.html?$/i, '') : subDir.replace(/\//g, '-');
          let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
          try {
            page = await browser.newPage();
            await navigateSafe(page, pageUrl, { timeout: 30000 });
            const fp = await collectFingerprint(page, pageUrl);
            const dest = saveFingerprint(fp, fpName);
            console.log(`  "${fpName}" saved: ${dest}`);
            collected.push(fpName);
          } finally {
            if (page) await page.close().catch(() => {});
          }
        }
      } finally {
        server.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n--- Collected ${collected.length} fingerprints ---`);
  for (const n of collected) console.log(`  ${n}`);
}

async function fingerprintDiff(values: Values, positionals: string[]): Promise<void> {
  const nameA = positionals[2];
  const nameB = positionals[3];
  if (!nameA || !nameB) {
    console.error('Usage: looksy fingerprint diff <name-before> <name-after>');
    process.exit(1);
  }
  const { loadFingerprint, compareFingerprints, formatFingerprintDiff } =
    await import('./fingerprint.js');
  const a = loadFingerprint(nameA);
  const b = loadFingerprint(nameB);
  const result = compareFingerprints(a, b, nameA, nameB);
  const compact = values.compact ?? false;
  console.log(formatFingerprintDiff(a, b, result, { compact }));
}

async function historySubcommand(positionals: string[]): Promise<void> {
  const slug = positionals[1];
  const entries = listHistory(slug);
  console.log(formatHistory(entries));
}

async function guardSubcommand(values: Values, positionals: string[]): Promise<void> {
  const subcommand = positionals[0];
  const name = subcommand === 'guard' ? positionals[1] : values.guard;
  if (!name) {
    console.error('Usage: looksy guard <baseline-name> [--threshold <percent>]');
    process.exit(1);
  }
  const threshold = values.threshold ? validateFloat('threshold', values.threshold) : 0.5;
  const urlArg = subcommand === 'guard' ? positionals[2] : positionals[0];
  if (!urlArg) {
    console.error('Usage: looksy guard <baseline-name> <url> [--threshold <percent>]');
    process.exit(1);
  }
  const guardUrl = resolveUrl(urlArg);
  const vp = resolveViewport(values);
  const baselinePath = resolve(`${LOOKSY_DIR}/baselines`, `${name}.png`);

  // First run: create baseline and exit PASS
  if (!existsSync(baselinePath)) {
    const result = await screenshot({
      url: guardUrl,
      output: DEFAULT_OUTPUT,
      ...vp,
      fullPage: values.full ?? false,
      darkMode: values.dark ?? false,
      inject: combineInject(values.inject, values.ignore),
      cookie: values.cookie,
      localStorage: values['local-storage'],
      dismissConsent: values['dismiss-consent'] ?? false,
    });
    saveBaseline(result.imagePath, name);
    console.log(`Baseline "${name}" created: ${baselinePath}`);
    console.log('PASS (first run — baseline created)');
    return;
  }

  // Baseline exists — screenshot and diff
  const result = await screenshot({
    url: guardUrl,
    output: DEFAULT_OUTPUT,
    ...vp,
    fullPage: values.full ?? false,
    darkMode: values.dark ?? false,
    inject: combineInject(values.inject, values.ignore),
    cookie: values.cookie,
    localStorage: values['local-storage'],
    dismissConsent: values['dismiss-consent'] ?? false,
  });
  const diff = await diffBaseline(result.imagePath, name, `${LOOKSY_DIR}/guard-diff.png`, {
    collectRegions: true,
  });
  const pct = parseFloat(diff.changePercent);
  if (pct > threshold) {
    console.error(`FAIL: ${diff.changePercent}% changed (threshold: ${threshold}%)`);
    console.log(diff.diffPath);
    await printChangedElements(diff.regions, name, guardUrl);
    process.exit(1);
  }
  console.log(`PASS: ${diff.changePercent}% changed (threshold: ${threshold}%)`);
  // Update baseline on pass
  saveBaseline(result.imagePath, name);
}
