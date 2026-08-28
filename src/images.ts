import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface ImageEntry {
  src: string;
  name: string;
  renderedWidth: number;
  renderedHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  format: string;
  transferSize: number;
  loading: 'lazy' | 'eager' | 'auto';
  aboveFold: boolean;
  oversized: boolean;
  missingDimensions: boolean;
  isNextImage: boolean;
  isSvg: boolean;
}

export interface ImageAuditData {
  images: ImageEntry[];
  totalCount: number;
  totalTransferSize: number;
  issues: { severity: 'high' | 'medium' | 'low'; message: string }[];
}

/** Extract image audit data from the page. */
export async function extractImages(page: Page): Promise<ImageAuditData> {
  const viewportHeight = await page.evaluate(() => window.innerHeight);

  const images: ImageEntry[] = await page.evaluate((vpHeight) => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map(img => {
      const rect = img.getBoundingClientRect();
      const src = img.currentSrc || img.src || '';
      const name = src.split('/').pop()?.split('?')[0] || src.slice(0, 50);
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const formatMap: Record<string, string> = {
        jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF', svg: 'SVG', gif: 'GIF',
      };
      const format = formatMap[ext] || (src.includes('data:image/svg') ? 'SVG' : 'unknown');
      const isNextImage = src.includes('/_next/image') || img.hasAttribute('data-nimg');
      const isSvg = format === 'SVG';
      const aboveFold = rect.top < vpHeight;
      const loading = (img.loading || 'auto') as 'lazy' | 'eager' | 'auto';

      return {
        src,
        name: name.length > 40 ? name.slice(0, 40) + '...' : name,
        renderedWidth: Math.round(rect.width),
        renderedHeight: Math.round(rect.height),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        format,
        transferSize: 0, // filled from network entries below
        loading,
        aboveFold,
        oversized: img.naturalWidth > 0 && rect.width > 0 && img.naturalWidth > rect.width * 2,
        missingDimensions: !img.hasAttribute('width') && !img.hasAttribute('height')
          && !img.style.width && !img.style.height,
        isNextImage,
        isSvg,
      };
    });
  }, viewportHeight);

  // Enrich with transfer sizes from network entries
  const netEntries = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return entries
      .filter(e => e.initiatorType === 'img' || e.initiatorType === 'css')
      .map(e => ({ url: e.name, transferSize: e.transferSize || 0 }));
  });

  const netMap = new Map(netEntries.map(e => [e.url, e.transferSize]));
  for (const img of images) {
    img.transferSize = netMap.get(img.src) || 0;
  }

  // Build issues
  const issues: ImageAuditData['issues'] = [];

  const aboveFoldLazy = images.filter(i => i.aboveFold && i.loading === 'lazy');
  if (aboveFoldLazy.length > 0) {
    issues.push({ severity: 'high', message: `${aboveFoldLazy.length} above-fold image(s) are lazy-loaded (should be eager/priority)` });
  }

  const belowFoldEager = images.filter(i => !i.aboveFold && i.loading === 'eager');
  if (belowFoldEager.length > 0) {
    issues.push({ severity: 'medium', message: `${belowFoldEager.length} below-fold image(s) are eager-loaded (could be lazy)` });
  }

  const oversized = images.filter(i => i.oversized);
  if (oversized.length > 0) {
    issues.push({ severity: 'high', message: `${oversized.length} image(s) served larger than rendered (>2x)` });
  }

  const missingDims = images.filter(i => i.missingDimensions && !i.isSvg);
  if (missingDims.length > 0) {
    issues.push({ severity: 'medium', message: `${missingDims.length} image(s) missing width/height (causes CLS)` });
  }

  const svgsInOptimizer = images.filter(i => i.isSvg && i.isNextImage);
  if (svgsInOptimizer.length > 0) {
    issues.push({ severity: 'low', message: `${svgsInOptimizer.length} SVG(s) going through image optimizer (wasteful)` });
  }

  const notOptimized = images.filter(i => !i.isNextImage && !i.isSvg && i.transferSize > 0);
  if (notOptimized.length > 0) {
    issues.push({ severity: 'low', message: `${notOptimized.length} image(s) not using Next.js image optimization` });
  }

  const totalTransferSize = images.reduce((s, i) => s + i.transferSize, 0);

  return { images, totalCount: images.length, totalTransferSize, issues };
}

/** Names of the images behind each issue, so a count is actionable (compact + issues list). */
export function imageOffenders(data: ImageAuditData): Array<{ label: string; names: string[] }> {
  const groups: Array<{ label: string; names: string[] }> = [];
  const push = (label: string, imgs: ImageEntry[]) => {
    if (imgs.length > 0) groups.push({ label, names: imgs.map((i) => i.name) });
  };
  push('lazy above fold', data.images.filter((i) => i.aboveFold && i.loading === 'lazy'));
  push('eager below fold', data.images.filter((i) => !i.aboveFold && i.loading === 'eager'));
  push('oversized (>2x rendered)', data.images.filter((i) => i.oversized));
  push('missing width/height', data.images.filter((i) => i.missingDimensions && !i.isSvg));
  push('SVG through image optimizer', data.images.filter((i) => i.isSvg && i.isNextImage));
  push('not using image optimizer', data.images.filter((i) => !i.isNextImage && !i.isSvg && i.transferSize > 0));
  return groups;
}

const listOf = (names: string[], limit: number): string =>
  `${names.slice(0, limit).join(', ')}${names.length > limit ? ` … and ${names.length - limit} more` : ''}`;

export function formatImages(data: ImageAuditData, opts: { compact?: boolean; limit?: number } = {}): string {
  if (data.images.length === 0) return '## Images: No images found\n';
  const limit = opts.limit ?? 10;

  if (opts.compact) {
    const parts = [
      `${data.totalCount} images`,
      `${formatBytes(data.totalTransferSize)}`,
    ];
    const highIssues = data.issues.filter(i => i.severity === 'high');
    if (highIssues.length > 0) parts.push(`${highIssues.length} critical issue(s)`);
    else if (data.issues.length > 0) parts.push(`${data.issues.length} issue(s)`);
    else parts.push('no issues');
    const lines = [`## Images: ${parts.join(' | ')}`];
    // Name the offenders — "2 issues" alone forced a manual re-derivation of which files.
    for (const g of imageOffenders(data)) lines.push(`- ${g.label} (${g.names.length}): ${listOf(g.names, limit)}`);
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## Image Audit\n'];
  lines.push(`**${data.totalCount} images** | ${formatBytes(data.totalTransferSize)} total\n`);

  lines.push('| Image | Format | Rendered | Natural | Size | Loading | Issues |');
  lines.push('|-------|--------|----------|---------|------|---------|--------|');
  for (const img of data.images.slice(0, 20)) {
    const issues: string[] = [];
    if (img.oversized) issues.push('oversized');
    if (img.missingDimensions) issues.push('no dims');
    if (img.aboveFold && img.loading === 'lazy') issues.push('lazy above fold');
    if (!img.aboveFold && img.loading === 'eager') issues.push('eager below fold');
    const issueStr = issues.length > 0 ? issues.join(', ') + ' ⚠' : '✓';
    const fold = img.aboveFold ? '↑' : '↓';
    lines.push(`| ${img.name} | ${img.format} | ${img.renderedWidth}x${img.renderedHeight} | ${img.naturalWidth}x${img.naturalHeight} | ${formatBytes(img.transferSize)} | ${img.loading} ${fold} | ${issueStr} |`);
  }
  if (data.images.length > 20) {
    lines.push(`| ... and ${data.images.length - 20} more | | | | | | |`);
  }

  // Issues
  if (data.issues.length > 0) {
    lines.push('');
    lines.push('### Issues\n');
    for (const issue of data.issues) {
      const icon = issue.severity === 'high' ? '✗' : issue.severity === 'medium' ? '⚠' : 'ℹ';
      lines.push(`- ${icon} **${issue.severity.toUpperCase()}:** ${issue.message}`);
    }
    for (const g of imageOffenders(data)) lines.push(`  - ${g.label}: ${listOf(g.names, limit)}`);
  }

  lines.push('');
  return lines.join('\n');
}
