/**
 * One-line stdout summaries for each analysis module.
 *
 * Analysis results live in the `.meta.md`/`.meta.json` sidecar, which is great for AI
 * consumption but invisible to a shell pipe. For CI/agent use, every active analyzer also
 * emits a single actionable line to stdout (e.g. `a11y: 0 issues, 7 landmarks`). This mirrors
 * what the `--check` block already does for assertions.
 *
 * Pure function of the analyzer's structured data — no browser, fully unit-testable.
 */

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)}KB`;
/** Render a numeric metric, or an em dash when it wasn't captured. */
const num = (n: number | undefined | null, unit = ''): string =>
  n === undefined || n === null ? '—' : `${n}${unit}`;

/** Append ` — name1, name2 … and N more` (largest-first callers pre-sort) so a count is actionable on stdout. */
const offenders = (names: string[], limit: number): string => {
  if (names.length === 0) return '';
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return ` — ${shown.join(', ')}${rest > 0 ? ` … and ${rest} more` : ''}`;
};

export function summarize(key: string, data: any, opts?: { limit?: number }): string | undefined {
  if (!data) return undefined;
  const limit = opts?.limit ?? 10;
  switch (key) {
    case 'perf':
      return `perf: FCP ${num(data.fcp, 'ms')}, LCP ${num(data.lcp, 'ms')}, CLS ${num(data.cls)}, TTFB ${num(data.ttfb, 'ms')}, ${data.resourceCount} reqs ${kb(data.totalTransferSize)}`;
    case 'a11y':
      return `a11y: ${data.issues.length} issue${data.issues.length === 1 ? '' : 's'}, ${data.landmarks.length} landmark${data.landmarks.length === 1 ? '' : 's'}`;
    case 'contrast': {
      const checked = data.sampled ?? data.pairs.length;
      const capped = data.capped && data.total > checked;
      const cov = capped ? `, ${data.total - checked} unchecked — raise with --contrast-limit` : '';
      const invisible = data.invisibleFailures ? `${data.invisibleFailures} invisible, ` : '';
      return `contrast: ${invisible}${data.aaFailures} AA fail, ${data.aaaFailures} AAA fail (${checked} checked${cov})`;
    }
    case 'network':
      return `network: ${data.resources.length} resources, ${kb(data.totalSize)}, ${data.slowCount} slow`;
    case 'domStats':
      return `dom: ${data.totalElements} elements, depth ${data.maxDepth}, ${data.inlineStyles} inline styles`;
    case 'cssVars':
      return `css-vars: ${data.length} custom propert${data.length === 1 ? 'y' : 'ies'}`;
    case 'fonts': {
      if (data.length === 0) return 'fonts: none detected';
      const families = [...new Set(data.map((f: any) => f.family))];
      return `fonts: ${data.length} (${families.slice(0, 4).join(', ')}${families.length > 4 ? ', …' : ''})`;
    }
    case 'lighthouse': {
      const parts = [`${data.longTasks} long tasks`];
      if (data.estimatedINP !== undefined) parts.push(`INP ~${data.estimatedINP}ms`);
      if (data.memoryUsed !== undefined)
        parts.push(`${(data.memoryUsed / 1048576).toFixed(0)}MB heap`);
      return `lighthouse: ${parts.join(', ')}`;
    }
    case 'links': {
      const broken = data.filter((l: any) => l.verdict === 'broken').length;
      const unverifiable = data.filter((l: any) => l.verdict === 'unverifiable').length;
      return `links: ${broken}/${data.length} broken, ${unverifiable} unverifiable`;
    }
    case 'classAudit':
      return `class-audit: ${data.totalClasses} classes, ${data.hashedClasses.length} hashed`;
    case 'fontSources':
      return `font-sources: ${data.sources.length} file${data.sources.length === 1 ? '' : 's'}, ${data.externalDomains.length} external domain${data.externalDomains.length === 1 ? '' : 's'}`;
    case 'assetHashes':
      return `asset-hashes: ${data.totalHashed} hashed asset${data.totalHashed === 1 ? '' : 's'}`;
    case 'seo': {
      // Full title, never truncated — a cut-off title in the one line people read first invites
      // false "title is truncated" alarms. Length is appended so the 60-char SEO limit is visible.
      const title = data.title ? `"${data.title}" (${data.title.length} chars)` : 'no title';
      return `seo: ${title}, ${data.schemaTypes.length} schema, ${Object.keys(data.og).length} og tags`;
    }
    case 'schema': {
      const issues = data.items.reduce((n: number, it: any) => n + it.issues.length, 0);
      const product = data.items.find(
        (it: any) => it.type === 'Product' && it.properties?.recommended,
      );
      const productNote = product ? `; Product ${product.properties.recommended}` : '';
      return `schema: ${data.items.length} items (${data.blockCount} blocks), ${issues} issues${productNote}`;
    }
    case 'bundles': {
      const names = [...data.largeChunks]
        .sort((a: any, b: any) => b.transferSize - a.transferSize)
        .map((c: any) => c.name);
      return `bundles: ${data.entries.length} chunks, ${kb(data.totalTransferSize)}, ${data.largeChunks.length} large${offenders(names, limit)}`;
    }
    case 'imageAudit': {
      const flagged = data.images.filter(
        (i: any) =>
          i.oversized ||
          (i.missingDimensions && !i.isSvg) ||
          (i.aboveFold && i.loading === 'lazy') ||
          (!i.aboveFold && i.loading === 'eager'),
      );
      const names = [...flagged]
        .sort((a: any, b: any) => b.transferSize - a.transferSize)
        .map((i: any) => i.name);
      return `images: ${data.totalCount} images, ${kb(data.totalTransferSize)}, ${data.issues.length} issues${offenders(names, limit)}`;
    }
    case 'compression': {
      const names = data.entries
        .filter((e: any) => e.encoding === 'none')
        .sort((a: any, b: any) => b.decodedSize - a.decodedSize)
        .map((e: any) => e.name);
      return `compression: ${data.noneCount} uncompressed, ${data.brotliCount} brotli, ${data.gzipCount} gzip${offenders(names, limit)}`;
    }
    case 'thirdParty':
      return `third-party: ${data.thirdPartyCount} origins, ${kb(data.thirdPartySize)}, ${data.renderBlockingCount} render-blocking`;
    case 'cacheAudit': {
      const names = data.entries
        .filter((e: any) => e.issue)
        .sort((a: any, b: any) => b.transferSize - a.transferSize)
        .map((e: any) => e.name);
      return `cache: ${data.noCacheCount} no-cache, ${data.shortTtlCount} short-ttl (${data.totalResources} resources)${offenders(names, limit)}`;
    }
    case 'criticalPath':
      return `critical-path: ${data.renderBlockingResources.length} blocking, ${kb(data.renderBlockingSize)}, TTFB ${num(data.timeToFirstByte, 'ms')}`;
    case 'resourceHints': {
      const names = [...data.missingPreconnects, ...data.unusedPreloads];
      return `resource-hints: ${data.existing.length} hints, ${data.missingPreconnects.length} missing preconnect, ${data.unusedPreloads.length} unused${offenders(names, limit)}`;
    }
    case 'serverTiming':
      return `server-timing: TTFB ${num(data.ttfb, 'ms')} (${data.ttfbRating}), ${data.entries.length} entries`;
    case 'responsiveCheck': {
      const bps = (data.breakpoints ?? []) as any[];
      const parts = bps.map((bp) => {
        const bits: string[] = [];
        if (bp.hasHorizontalOverflow)
          bits.push(`hscroll${bp.scrollWidth ? ` +${bp.scrollWidth - bp.width}px` : ''}`);
        if (bp.smallTouchTargets > 0)
          bits.push(`${bp.smallTouchTargets} controls < ${data.targetSize ?? 44}px`);
        if (bp.tinyText > 0) bits.push(`${bp.tinyText} tiny text`);
        if (bp.contrastAaFailures) bits.push(`${bp.contrastAaFailures} AA fail`);
        return `${bp.width}px ${bits.length ? bits.join(', ') : 'ok'}`;
      });
      return `responsive: ${parts.join(' | ')}`;
    }
    case 'coverage':
      return `coverage: ${data.overallPercent}% used (${kb(data.usedBytes)}/${kb(data.totalBytes)})`;
    case 'imageOptimizer': {
      const checked = Array.isArray(data.probes) ? data.probes : [data];
      if (checked.length === 0) return undefined;
      const passThrough = checked.find((p: any) => p.verdict === 'PASS-THROUGH');
      if (passThrough)
        return `image-optimizer: PASS-THROUGH (w=${passThrough.small.w} and w=${passThrough.large.w} both ${kb(passThrough.small.bytes)})`;
      return `image-optimizer: OK (${checked.length} checked)`;
    }
    default:
      return undefined;
  }
}
