import type { Page } from 'playwright';
import { extractPerf, formatPerf } from './perf.js';
import { extractA11yData, formatA11y } from './a11y.js';
import { extractContrast } from './contrast.js';
import { extractNetworkData, formatNetwork } from './network.js';
import { extractDomStats, formatDomStats } from './dom-stats.js';
import { extractCssVars, formatCssVars } from './css-vars.js';
import { extractFonts, formatFonts } from './fonts.js';
import { extractLighthouse, formatLighthouse } from './lighthouse.js';
import { checkLinks, formatLinks } from './links.js';
import { extractClassAudit, formatClassAudit } from './class-audit.js';
import { extractFontSources, formatFontSources } from './font-sources.js';
import { extractAssetHashes, formatAssetHashes } from './asset-hashes.js';
import { extractSeo, formatSeo } from './seo.js';
import { extractSchema, formatSchema } from './schema.js';
import { extractBundles, formatBundles } from './bundles.js';
import { extractImages, formatImages } from './images.js';
import { extractCompression, formatCompression } from './compression.js';
import { extractThirdParty, formatThirdParty } from './third-party.js';
import { extractCacheAudit, formatCacheAudit, type CacheHeaderInfo } from './cache-audit.js';
import { extractCriticalPath, formatCriticalPath } from './critical-path.js';
import { extractResourceHints, formatResourceHints } from './resource-hints.js';
import { extractServerTiming, formatServerTiming } from './server-timing.js';
import { extractImageOptimizer, formatImageOptimizer } from './image-optimizer.js';
import { summarize } from './analysis-summary.js';
import type { ScreenshotConfig, ScreenshotResult } from './screenshot-types.js';

export interface AnalysisModuleResult {
  /** Markdown section written to the .meta.md sidecar. */
  section: string;
  /** One-line summary echoed to stdout for CI/agent use. */
  summary?: string;
}

export interface AnalysisModule {
  flag: boolean | undefined;
  key: string;
  run: () => Promise<AnalysisModuleResult>;
}

/** Build the list of analysis modules for a screenshot run.
 * Each module is lazily executed later (in parallel), and writes into `result.jsonData` if JSON mode is on. */
export function buildAnalysisModules(
  page: Page,
  config: ScreenshotConfig,
  result: ScreenshotResult,
  compact: boolean,
  cacheHeadersByUrl?: Map<string, CacheHeaderInfo>,
): AnalysisModule[] {
  return [
    {
      flag: config.perf,
      key: 'perf',
      run: async () => {
        const m = await extractPerf(page);
        if (result.jsonData) result.jsonData.perf = m;
        return { section: formatPerf(m, { compact }), summary: summarize('perf', m) };
      },
    },
    {
      flag: config.a11y,
      key: 'a11y',
      run: async () => {
        const d = await extractA11yData(page, { fragment: config.fragment });
        if (result.jsonData) result.jsonData.a11y = d;
        return { section: formatA11y(d, { compact }), summary: summarize('a11y', d) };
      },
    },
    {
      flag: config.contrast,
      key: 'contrast',
      run: async () => {
        const cr = await extractContrast(page, {
          compact,
          visibleOnly: config.visibleOnly,
          limit: config.contrastLimit,
        });
        result.contrastFailures = {
          aa: cr.aaFailures,
          aaa: cr.aaaFailures,
          invisible: cr.invisibleFailures,
        };
        result.contrastPairs = cr.pairs;
        if (result.jsonData)
          result.jsonData.contrast = {
            pairs: cr.pairs,
            aaFailures: cr.aaFailures,
            aaaFailures: cr.aaaFailures,
            invisibleFailures: cr.invisibleFailures,
            sampled: cr.sampled,
            total: cr.total,
            capped: cr.capped,
          };
        return { section: cr.text, summary: summarize('contrast', cr) };
      },
    },
    {
      flag: config.network,
      key: 'network',
      run: async () => {
        const d = await extractNetworkData(page);
        if (result.jsonData) result.jsonData.network = d;
        return { section: formatNetwork(d, { compact }), summary: summarize('network', d) };
      },
    },
    {
      flag: config.domStats,
      key: 'domStats',
      run: async () => {
        const s = await extractDomStats(page);
        if (result.jsonData) result.jsonData.domStats = s;
        return { section: formatDomStats(s, { compact }), summary: summarize('domStats', s) };
      },
    },
    {
      flag: config.cssVars,
      key: 'cssVars',
      run: async () => {
        const v = await extractCssVars(page);
        if (result.jsonData) result.jsonData.cssVars = v;
        return { section: formatCssVars(v, { compact }), summary: summarize('cssVars', v) };
      },
    },
    {
      flag: config.fonts,
      key: 'fonts',
      run: async () => {
        const f = await extractFonts(page);
        if (result.jsonData) result.jsonData.fonts = f;
        return { section: formatFonts(f, { compact }), summary: summarize('fonts', f) };
      },
    },
    {
      flag: config.lighthouse,
      key: 'lighthouse',
      run: async () => {
        const d = await extractLighthouse(page);
        if (result.jsonData) result.jsonData.lighthouse = d;
        return { section: formatLighthouse(d, { compact }), summary: summarize('lighthouse', d) };
      },
    },
    {
      flag: config.links,
      key: 'links',
      run: async () => {
        const allow = config.linksAllow
          ? config.linksAllow
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const l = await checkLinks(page, { allow });
        if (result.jsonData) result.jsonData.links = l;
        return { section: formatLinks(l, { compact }), summary: summarize('links', l) };
      },
    },
    {
      flag: config.classAudit,
      key: 'classAudit',
      run: async () => {
        const d = await extractClassAudit(page);
        if (result.jsonData) result.jsonData.classAudit = d;
        return { section: formatClassAudit(d, { compact }), summary: summarize('classAudit', d) };
      },
    },
    {
      flag: config.fontSources,
      key: 'fontSources',
      run: async () => {
        const d = await extractFontSources(page);
        if (result.jsonData) result.jsonData.fontSources = d;
        return { section: formatFontSources(d, { compact }), summary: summarize('fontSources', d) };
      },
    },
    {
      flag: config.assetHashes,
      key: 'assetHashes',
      run: async () => {
        const d = await extractAssetHashes(page);
        if (result.jsonData) result.jsonData.assetHashes = d;
        return { section: formatAssetHashes(d, { compact }), summary: summarize('assetHashes', d) };
      },
    },
    {
      flag: config.seo,
      key: 'seo',
      run: async () => {
        const d = await extractSeo(page);
        if (result.jsonData) result.jsonData.seo = d;
        return {
          section: formatSeo(d, { compact, fragment: config.fragment }),
          summary: summarize('seo', d),
        };
      },
    },
    {
      flag: config.schema,
      key: 'schema',
      run: async () => {
        const d = await extractSchema(page);
        if (result.jsonData) result.jsonData.schema = d;
        return { section: formatSchema(d, { compact }), summary: summarize('schema', d) };
      },
    },
    {
      flag: config.bundles,
      key: 'bundles',
      run: async () => {
        const d = await extractBundles(page);
        if (result.jsonData) result.jsonData.bundles = d;
        return {
          section: formatBundles(d, { compact, limit: config.listLimit }),
          summary: summarize('bundles', d, { limit: config.listLimit }),
        };
      },
    },
    {
      flag: config.imageAudit,
      key: 'imageAudit',
      run: async () => {
        const d = await extractImages(page);
        if (result.jsonData) result.jsonData.imageAudit = d;
        return {
          section: formatImages(d, { compact, limit: config.listLimit }),
          summary: summarize('imageAudit', d, { limit: config.listLimit }),
        };
      },
    },
    {
      flag: config.compression,
      key: 'compression',
      run: async () => {
        const d = await extractCompression(page);
        if (result.jsonData) result.jsonData.compression = d;
        return {
          section: formatCompression(d, { compact, limit: config.listLimit }),
          summary: summarize('compression', d, { limit: config.listLimit }),
        };
      },
    },
    {
      flag: config.thirdParty,
      key: 'thirdParty',
      run: async () => {
        const d = await extractThirdParty(page);
        if (result.jsonData) result.jsonData.thirdParty = d;
        return { section: formatThirdParty(d, { compact }), summary: summarize('thirdParty', d) };
      },
    },
    {
      flag: config.cacheAudit,
      key: 'cacheAudit',
      run: async () => {
        const d = await extractCacheAudit(page, cacheHeadersByUrl);
        if (result.jsonData) result.jsonData.cacheAudit = d;
        return {
          section: formatCacheAudit(d, { compact, limit: config.listLimit }),
          summary: summarize('cacheAudit', d, { limit: config.listLimit }),
        };
      },
    },
    {
      flag: config.criticalPath,
      key: 'criticalPath',
      run: async () => {
        const d = await extractCriticalPath(page);
        if (result.jsonData) result.jsonData.criticalPath = d;
        return {
          section: formatCriticalPath(d, { compact }),
          summary: summarize('criticalPath', d),
        };
      },
    },
    {
      flag: config.resourceHints,
      key: 'resourceHints',
      run: async () => {
        const d = await extractResourceHints(page);
        if (result.jsonData) result.jsonData.resourceHints = d;
        return {
          section: formatResourceHints(d, { compact }),
          summary: summarize('resourceHints', d, { limit: config.listLimit }),
        };
      },
    },
    {
      flag: config.serverTiming,
      key: 'serverTiming',
      run: async () => {
        const d = await extractServerTiming(page);
        if (result.jsonData) result.jsonData.serverTiming = d;
        return {
          section: formatServerTiming(d, { compact }),
          summary: summarize('serverTiming', d),
        };
      },
    },
    {
      flag: config.imageOptimizer,
      key: 'imageOptimizer',
      run: async () => {
        const d = await extractImageOptimizer(page);
        if (result.jsonData) result.jsonData.imageOptimizer = d;
        return {
          section: formatImageOptimizer(d, { compact }),
          summary: summarize('imageOptimizer', d),
        };
      },
    },
  ];
}
