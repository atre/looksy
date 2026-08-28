import type { Page } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateBaselineName, LOOKSY_DIR } from './utils.js';
import { extractClassAudit, type ClassAuditData } from './class-audit.js';
import { extractFontSources, type FontSourcesData } from './font-sources.js';
import { extractAssetHashes, type AssetHashData } from './asset-hashes.js';
import { extractSeo, type SeoData } from './seo.js';

const FINGERPRINTS_DIR = `${LOOKSY_DIR}/fingerprints`;

// ---------- Fingerprint data shape ----------

export interface DomStructure {
  /** Heading level sequence, e.g. [1, 2, 2, 3, 2] */
  headingSequence: number[];
  /** Count of key structural elements */
  sectionCount: number;
  navCount: number;
  footerCount: number;
  articleCount: number;
  formCount: number;
  /** Max nesting depth */
  maxDepth: number;
  /** Total element count */
  totalElements: number;
}

export interface NavStructure {
  headerLinkCount: number;
  footerLinkCount: number;
  hasHeader: boolean;
  hasFooter: boolean;
  hasNav: boolean;
}

export interface FingerprintData {
  url: string;
  capturedAt: string;
  domStructure: DomStructure;
  navStructure: NavStructure;
  /** Ordered meta tag names from <head> */
  metaTagOrder: string[];
  /** External script/stylesheet hostnames */
  externalOrigins: string[];
  /** From class-audit: hashed class names */
  hashedClasses: string[];
  /** From class-audit: top class names */
  topClassNames: string[];
  /** From font-sources: external CDN domains */
  fontDomains: string[];
  /** From asset-hashes: build directory prefixes */
  buildDirs: string[];
  /** From asset-hashes: content hash values */
  contentHashes: string[];
  /** From SEO: generator tag */
  generator: string | null;
  /** From SEO: favicon URL */
  favicon: string | null;
  /** From SEO: schema types (JSON-LD) */
  schemaTypes: string[];
  /** Font families in use */
  fontStack: string[];
  /** Asset filenames (JS/CSS/font) for cross-site comparison */
  assetFilenames?: string[];
  /** SHA-256 hashes (first 16 hex chars) of inline `<script>` contents — distinct fingerprint signal */
  inlineScriptHashes?: string[];
}

// ---------- Extraction ----------

async function extractDomStructure(page: Page): Promise<DomStructure> {
  return page.evaluate(() => {
    const headingSequence: number[] = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      headingSequence.push(parseInt(el.tagName[1]));
    }

    // Iterative max-depth to avoid named function inside evaluate
    // (named functions get __name()-wrapped by esbuild keepNames, which breaks in browser context)
    let maxD = 0;
    if (document.body) {
      const stack: Array<[Element, number]> = [[document.body, 0]];
      while (stack.length > 0) {
        const [el, depth] = stack.pop()!;
        if (depth > maxD) maxD = depth;
        for (const child of el.children) stack.push([child, depth + 1]);
      }
    }

    return {
      headingSequence,
      sectionCount: document.querySelectorAll('section').length,
      navCount: document.querySelectorAll('nav').length,
      footerCount: document.querySelectorAll('footer').length,
      articleCount: document.querySelectorAll('article').length,
      formCount: document.querySelectorAll('form').length,
      maxDepth: maxD,
      totalElements: document.querySelectorAll('*').length,
    };
  });
}

async function extractNavStructure(page: Page): Promise<NavStructure> {
  return page.evaluate(() => {
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    const nav = document.querySelector('nav');
    return {
      headerLinkCount: header ? header.querySelectorAll('a[href]').length : 0,
      footerLinkCount: footer ? footer.querySelectorAll('a[href]').length : 0,
      hasHeader: !!header,
      hasFooter: !!footer,
      hasNav: !!nav,
    };
  });
}

async function extractMetaTagOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const metas: string[] = [];
    for (const el of document.querySelectorAll('head meta[name], head meta[property], head meta[charset], head meta[http-equiv]')) {
      const name = el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('http-equiv') || (el.hasAttribute('charset') ? 'charset' : '');
      if (name) metas.push(name);
    }
    return metas.slice(0, 20);
  });
}

async function extractExternalOrigins(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const origins = new Set<string>();
    const pageHost = location.hostname;
    // Inline URL checking to avoid named function/const inside evaluate
    // (esbuild keepNames wraps these with __name() which doesn't exist in browser context)
    const srcs: Array<string | null> = [];
    for (const el of document.querySelectorAll('script[src]')) srcs.push(el.getAttribute('src'));
    for (const el of document.querySelectorAll('link[href]')) srcs.push(el.getAttribute('href'));
    for (const el of document.querySelectorAll('img[src]')) srcs.push(el.getAttribute('src'));
    for (const src of srcs) {
      if (!src) continue;
      try {
        const u = new URL(src, location.href);
        if (u.hostname && u.hostname !== pageHost && u.hostname !== 'localhost') {
          origins.add(u.hostname);
        }
      } catch { /* invalid URL */ }
    }
    return Array.from(origins).sort();
  });
}

async function extractInlineScriptHashes(page: Page): Promise<string[]> {
  const contents: string[] = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('script:not([src])')) {
      const text = (el.textContent || '').trim();
      // Skip trivial scripts (initialization stubs etc) — we want signal, not noise
      if (text.length < 20) continue;
      out.push(text);
    }
    return out.slice(0, 30);
  });
  return contents.map((c) => createHash('sha256').update(c).digest('hex').slice(0, 16)).sort();
}

async function extractFontStack(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fonts = new Set<string>();
    for (const el of document.querySelectorAll('body,h1,h2,h3,p,a,button,span')) {
      const ff = getComputedStyle(el).fontFamily;
      if (ff) fonts.add(ff.split(',')[0].trim().replace(/['"]/g, ''));
    }
    return Array.from(fonts).sort();
  });
}

/**
 * Collect a full structural fingerprint from a page.
 * Reuses existing extractors (class-audit, font-sources, asset-hashes, seo)
 * plus custom DOM/nav/meta/external-origins extraction.
 */
export async function collectFingerprint(page: Page, url: string): Promise<FingerprintData> {
  const [domStructure, navStructure, metaTagOrder, externalOrigins, fontStack, classAudit, fontSources, assetHashes, seo, inlineScriptHashes] =
    await Promise.all([
      extractDomStructure(page),
      extractNavStructure(page),
      extractMetaTagOrder(page),
      extractExternalOrigins(page),
      extractFontStack(page),
      extractClassAudit(page),
      extractFontSources(page),
      extractAssetHashes(page),
      extractSeo(page),
      extractInlineScriptHashes(page),
    ]);

  return {
    url,
    capturedAt: new Date().toISOString(),
    domStructure,
    navStructure,
    metaTagOrder,
    externalOrigins,
    hashedClasses: classAudit.hashedClasses,
    topClassNames: classAudit.topClasses.map((c) => c.name),
    fontDomains: fontSources.externalDomains,
    buildDirs: assetHashes.buildDirs,
    contentHashes: assetHashes.assets.map((a) => a.hash).filter(Boolean),
    generator: seo.generator,
    favicon: seo.favicon,
    schemaTypes: seo.schemaTypes,
    fontStack,
    assetFilenames: assetHashes.assets.map((a) => a.filename),
    inlineScriptHashes,
  };
}

// ---------- Storage ----------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function saveFingerprint(data: FingerprintData, name: string): string {
  validateBaselineName(name);
  ensureDir(FINGERPRINTS_DIR);
  const dest = resolve(FINGERPRINTS_DIR, `${name}.json`);
  writeFileSync(dest, JSON.stringify(data, null, 2));
  return dest;
}

export function loadFingerprint(name: string): FingerprintData {
  validateBaselineName(name);
  const path = resolve(FINGERPRINTS_DIR, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Fingerprint "${name}" not found. Run: looksy fingerprint collect <url> --save ${name}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function listFingerprints(): string[] {
  if (!existsSync(FINGERPRINTS_DIR)) return [];
  return readdirSync(FINGERPRINTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort();
}

// ---------- Comparison ----------

interface JaccardResult {
  score: number;
  sharedCount: number;
  unionSize: number;
  shared: string[];
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B|, returns 0-1 plus shared items. Empty sets score 0 (no signal). */
function jaccard(a: string[], b: string[]): JaccardResult {
  if (a.length === 0 && b.length === 0) return { score: 0, sharedCount: 0, unionSize: 0, shared: [] };
  const setA = new Set(a);
  const setB = new Set(b);
  const shared: string[] = [];
  for (const x of setA) if (setB.has(x)) shared.push(x);
  const unionSize = setA.size + setB.size - shared.length;
  return { score: unionSize === 0 ? 0 : shared.length / unionSize, sharedCount: shared.length, unionSize, shared };
}

/** LCS length for short arrays (meta tag order comparison) */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/** Heading sequence similarity: compare pattern as string */
function headingSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Use LCS on heading patterns
  const aStr = a.map(String);
  const bStr = b.map(String);
  const lcs = lcsLength(aStr, bStr);
  return lcs / Math.max(a.length, b.length);
}

export interface DimensionScore {
  name: string;
  score: number; // 0-1
  weight: number;
  detail: string;
}

export interface FingerprintCompareResult {
  nameA: string;
  nameB: string;
  urlA: string;
  urlB: string;
  overall: number; // 0-100
  dimensions: DimensionScore[];
}

const WEIGHTS = {
  hashedClasses: 15,
  externalOrigins: 15,
  domStructure: 20,
  fontSources: 10,
  buildDirs: 5,
  metaTagOrder: 10,
  assetFilenames: 25,
  inlineScripts: 10,
};

export function compareFingerprints(a: FingerprintData, b: FingerprintData, nameA: string, nameB: string): FingerprintCompareResult {
  const dimensions: DimensionScore[] = [];

  // 1. Hashed classes
  const hc = jaccard(a.hashedClasses, b.hashedClasses);
  dimensions.push({
    name: 'Hashed Classes',
    score: hc.score,
    weight: WEIGHTS.hashedClasses,
    detail: hc.unionSize === 0 ? 'none detected (excluded)' : `${hc.sharedCount} shared of ${hc.unionSize} unique`,
  });

  // 2. External origins
  const eo = jaccard(a.externalOrigins, b.externalOrigins);
  dimensions.push({
    name: 'External Origins',
    score: eo.score,
    weight: WEIGHTS.externalOrigins,
    detail: eo.sharedCount > 0 ? `shared: ${eo.shared.join(', ')}` : 'no overlap',
  });

  // 3. DOM structure (heading similarity + section/nav/footer count delta)
  const hSim = headingSimilarity(a.domStructure.headingSequence, b.domStructure.headingSequence);
  const sCounts = ['sectionCount', 'navCount', 'footerCount', 'articleCount'] as const;
  let countSim = 0;
  for (const k of sCounts) {
    const va = a.domStructure[k];
    const vb = b.domStructure[k];
    countSim += va === 0 && vb === 0 ? 1 : 1 - Math.abs(va - vb) / Math.max(va, vb, 1);
  }
  countSim /= sCounts.length;
  const domScore = hSim * 0.6 + countSim * 0.4;
  dimensions.push({
    name: 'DOM Structure',
    score: domScore,
    weight: WEIGHTS.domStructure,
    detail: `heading similarity ${(hSim * 100).toFixed(0)}%, structure similarity ${(countSim * 100).toFixed(0)}%`,
  });

  // 4. Font sources
  const fs = jaccard(a.fontDomains, b.fontDomains);
  dimensions.push({
    name: 'Font Sources',
    score: fs.score,
    weight: WEIGHTS.fontSources,
    detail: a.fontDomains.length === 0 && b.fontDomains.length === 0
      ? 'both self-hosted (excluded)'
      : `A: ${a.fontDomains.join(', ') || 'none'} | B: ${b.fontDomains.join(', ') || 'none'}`,
  });

  // 5. Build directories
  const bd = jaccard(a.buildDirs, b.buildDirs);
  dimensions.push({
    name: 'Build Dirs',
    score: bd.score,
    weight: WEIGHTS.buildDirs,
    detail: a.buildDirs.length === 0 && b.buildDirs.length === 0
      ? 'none detected (excluded)'
      : `A: ${a.buildDirs.join(', ') || 'none'} | B: ${b.buildDirs.join(', ') || 'none'}`,
  });

  // 6. Meta tag order (LCS-based)
  const mtLen = Math.max(a.metaTagOrder.length, b.metaTagOrder.length);
  const mtLcs = mtLen === 0 ? 0 : lcsLength(a.metaTagOrder, b.metaTagOrder);
  dimensions.push({
    name: 'Meta Tag Order',
    score: mtLen === 0 ? 0 : mtLcs / mtLen,
    weight: WEIGHTS.metaTagOrder,
    detail: `LCS ${mtLcs}/${mtLen} tags`,
  });

  // 7. Asset filenames
  const af = jaccard(a.assetFilenames ?? [], b.assetFilenames ?? []);
  dimensions.push({
    name: 'Asset Filenames',
    score: af.score,
    weight: WEIGHTS.assetFilenames,
    detail: af.unionSize === 0 ? 'none detected (excluded)' : `${af.sharedCount} shared of ${af.unionSize} unique`,
  });

  // 8. Inline script hashes
  const isr = jaccard(a.inlineScriptHashes ?? [], b.inlineScriptHashes ?? []);
  dimensions.push({
    name: 'Inline Scripts',
    score: isr.score,
    weight: WEIGHTS.inlineScripts,
    detail: isr.unionSize === 0 ? 'none detected (excluded)' : `${isr.sharedCount} shared of ${isr.unionSize} unique`,
  });

  // Overall weighted score
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const overall = dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight * 100;

  return { nameA, nameB, urlA: a.url, urlB: b.url, overall, dimensions };
}

// ---------- Formatting ----------

function riskLevel(score: number): string {
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'MINIMAL';
}

export function formatFingerprintCompare(result: FingerprintCompareResult, opts: { compact?: boolean } = {}): string {
  const risk = riskLevel(result.overall);

  if (opts.compact) {
    const dims = result.dimensions.filter((d) => d.score > 0.3).map((d) => `${d.name} ${(d.score * 100).toFixed(0)}%`).join(', ');
    return `Similarity: ${result.overall.toFixed(0)}% (${risk}) — ${result.nameA} vs ${result.nameB}${dims ? ` | ${dims}` : ''}\n`;
  }

  const lines = [`## Fingerprint Comparison: ${result.nameA} vs ${result.nameB}\n`];
  lines.push(`**Overall Similarity: ${result.overall.toFixed(1)}% — ${risk} risk**\n`);
  lines.push(`- ${result.nameA}: ${result.urlA}`);
  lines.push(`- ${result.nameB}: ${result.urlB}`);
  lines.push('');

  lines.push('| Dimension | Weight | Similarity | Detail |');
  lines.push('|-----------|--------|-----------|--------|');
  for (const d of result.dimensions) {
    const bar = d.score >= 0.7 ? '!!!' : d.score >= 0.3 ? '!' : '';
    lines.push(`| ${d.name} | ${d.weight}% | ${(d.score * 100).toFixed(0)}% ${bar} | ${d.detail} |`);
  }
  lines.push('');

  if (result.overall >= 50) {
    lines.push('### Recommendations\n');
    for (const d of result.dimensions.filter((d) => d.score >= 0.5)) {
      lines.push(`- **${d.name}** (${(d.score * 100).toFixed(0)}% similar): Diversify to reduce cross-site correlation`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatSimilarityMatrix(fingerprints: FingerprintData[], names: string[]): string {
  const n = fingerprints.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(100));

  // Compute pairwise
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const result = compareFingerprints(fingerprints[i], fingerprints[j], names[i], names[j]);
      matrix[i][j] = result.overall;
      matrix[j][i] = result.overall;
    }
  }

  const lines = ['## Fingerprint Similarity Matrix\n'];

  // Header
  const maxNameLen = Math.max(...names.map((n) => n.length), 4);
  const pad = (s: string) => s.padEnd(maxNameLen);
  lines.push(`| ${pad('')} | ${names.map((n) => pad(n)).join(' | ')} |`);
  lines.push(`|${'-'.repeat(maxNameLen + 2)}|${names.map(() => '-'.repeat(maxNameLen + 2)).join('|')}|`);

  for (let i = 0; i < n; i++) {
    const cells = matrix[i].map((v, j) => {
      if (i === j) return pad('--');
      const risk = v >= 80 ? '!!!' : v >= 50 ? '!' : '';
      return pad(`${v.toFixed(0)}%${risk}`);
    });
    lines.push(`| ${pad(names[i])} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  // Flag high-risk pairs
  const highRisk: string[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matrix[i][j] >= 50) {
        highRisk.push(`${names[i]} ↔ ${names[j]}: ${matrix[i][j].toFixed(0)}% (${riskLevel(matrix[i][j])})`);
      }
    }
  }
  if (highRisk.length > 0) {
    lines.push('### High-Risk Pairs\n');
    for (const r of highRisk) lines.push(`- ${r}`);
    lines.push('');
  }

  return lines.join('\n');
}

/** Format a diff between two versions of the same site, showing what changed. */
export function formatFingerprintDiff(
  before: FingerprintData,
  after: FingerprintData,
  result: FingerprintCompareResult,
  opts: { compact?: boolean } = {},
): string {
  const lines: string[] = [];

  if (opts.compact) {
    lines.push(`Fingerprint diff: ${result.nameA} → ${result.nameB} | ${result.overall.toFixed(0)}% similar`);
    const changed = result.dimensions.filter((d) => d.score < 1);
    if (changed.length > 0) {
      lines.push(`Changed: ${changed.map((d) => `${d.name} ${(d.score * 100).toFixed(0)}%`).join(', ')}`);
    } else {
      lines.push('No changes detected');
    }
    return lines.join('\n') + '\n';
  }

  lines.push(`## Fingerprint Diff: ${result.nameA} → ${result.nameB}\n`);
  lines.push(`**Overall similarity: ${result.overall.toFixed(1)}%**\n`);
  lines.push(`- Before: ${before.url} (${before.capturedAt})`);
  lines.push(`- After: ${after.url} (${after.capturedAt})`);
  lines.push('');

  // Show what changed per dimension — single-pass added/removed/kept computation
  const setDiff = (label: string, a: string[], b: string[]) => {
    const setA = new Set(a);
    const setB = new Set(b);
    const added: string[] = [];
    const removed: string[] = [];
    const kept: string[] = [];
    for (const x of a) (setB.has(x) ? kept : removed).push(x);
    for (const x of b) if (!setA.has(x)) added.push(x);
    if (added.length === 0 && removed.length === 0) return;
    lines.push(`### ${label}\n`);
    if (removed.length > 0) lines.push(`- Removed: ${removed.join(', ')}`);
    if (added.length > 0) lines.push(`+ Added: ${added.join(', ')}`);
    if (kept.length > 0) lines.push(`= Kept: ${kept.join(', ')}`);
    lines.push('');
  };

  setDiff('Hashed Classes', before.hashedClasses, after.hashedClasses);
  setDiff('External Origins', before.externalOrigins, after.externalOrigins);
  setDiff('Font Domains', before.fontDomains, after.fontDomains);
  setDiff('Build Dirs', before.buildDirs, after.buildDirs);
  setDiff('Asset Filenames', before.assetFilenames ?? [], after.assetFilenames ?? []);
  setDiff('Inline Scripts', before.inlineScriptHashes ?? [], after.inlineScriptHashes ?? []);
  setDiff('Content Hashes', before.contentHashes, after.contentHashes);
  setDiff('Font Stack', before.fontStack, after.fontStack);
  setDiff('Schema Types', before.schemaTypes, after.schemaTypes);

  // DOM structure delta
  const domBefore = before.domStructure;
  const domAfter = after.domStructure;
  const domChanges: string[] = [];
  if (domBefore.totalElements !== domAfter.totalElements)
    domChanges.push(`elements: ${domBefore.totalElements} → ${domAfter.totalElements}`);
  if (domBefore.maxDepth !== domAfter.maxDepth)
    domChanges.push(`depth: ${domBefore.maxDepth} → ${domAfter.maxDepth}`);
  if (domBefore.sectionCount !== domAfter.sectionCount)
    domChanges.push(`sections: ${domBefore.sectionCount} → ${domAfter.sectionCount}`);
  if (JSON.stringify(domBefore.headingSequence) !== JSON.stringify(domAfter.headingSequence))
    domChanges.push(`headings: [${domBefore.headingSequence}] → [${domAfter.headingSequence}]`);
  if (domChanges.length > 0) {
    lines.push('### DOM Structure\n');
    for (const c of domChanges) lines.push(`- ${c}`);
    lines.push('');
  }

  // Generator change
  if (before.generator !== after.generator) {
    lines.push(`### Generator\n\n- ${before.generator ?? 'none'} → ${after.generator ?? 'none'}\n`);
  }

  // Summary table
  lines.push('### Dimension Scores\n');
  lines.push('| Dimension | Similarity | Status |');
  lines.push('|-----------|-----------|--------|');
  for (const d of result.dimensions) {
    const status = d.score >= 1 ? 'unchanged' : d.score >= 0.5 ? 'partially changed' : d.score > 0 ? 'mostly changed' : 'fully changed';
    lines.push(`| ${d.name} | ${(d.score * 100).toFixed(0)}% | ${status} |`);
  }
  lines.push('');

  return lines.join('\n');
}
