import type { Page } from 'playwright';

export interface AssetHashData {
  /** All asset filenames with content hashes detected */
  assets: Array<{
    url: string;
    filename: string;
    type: string;
    /** The hash portion of the filename, if detected */
    hash: string;
  }>;
  /** Directory prefixes found (e.g. _astro/, _next/) */
  buildDirs: string[];
  /** Total hashed assets */
  totalHashed: number;
}

/**
 * Extract hashed asset filenames from the page — scripts, stylesheets, images.
 * Identical content hashes across different sites are a network fingerprint signal.
 */
export async function extractAssetHashes(page: Page): Promise<AssetHashData> {
  return await page.evaluate(() => {
    const assets: Array<{ url: string; filename: string; type: string; hash: string }> = [];
    const seen = new Set<string>();

    // Hash patterns: _astro/Component.abc12345.js, chunk-ABCDE.js, [name].[hash].ext
    const hashPattern = /[._-]([a-f0-9]{6,}|[A-Za-z0-9_-]{6,})\.(js|css|mjs|woff2?|png|jpg|jpeg|svg|webp|avif)$/;
    // Build directory patterns
    const buildDirPattern = /\/(_{0,2}(astro|next|nuxt|gatsby|vite|parcel|webpack|remix|sveltekit)[\w-]*)\//i;

    // Collect all URLs with their types — avoids named helper function inside evaluate
    // (esbuild keepNames wraps named functions with __name() which doesn't exist in browser context)
    const urlEntries: Array<[string, string]> = [];
    for (const el of document.querySelectorAll('script[src]')) urlEntries.push([(el as HTMLScriptElement).src, 'script']);
    for (const el of document.querySelectorAll('link[rel="stylesheet"]')) urlEntries.push([(el as HTMLLinkElement).href, 'stylesheet']);
    for (const el of document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"]')) urlEntries.push([(el as HTMLLinkElement).href, 'preload']);
    for (const el of document.querySelectorAll('img[src]')) urlEntries.push([(el as HTMLImageElement).src, 'image']);
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) urlEntries.push([e.name, e.initiatorType]);

    for (const [url, type] of urlEntries) {
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const filename = url.split('/').pop()?.split('?')[0] || '';
      const hashMatch = filename.match(hashPattern);
      if (!hashMatch) continue;

      assets.push({ url, filename, type, hash: hashMatch[1] });
    }

    // Extract unique build directory prefixes
    const buildDirs = [...new Set(
      assets.map((a) => {
        const m = a.url.match(buildDirPattern);
        return m ? m[1] : null;
      }).filter(Boolean) as string[],
    )];

    return {
      assets: assets.slice(0, 100),
      buildDirs,
      totalHashed: assets.length,
    };
  });
}

export function formatAssetHashes(data: AssetHashData, opts: { compact?: boolean } = {}): string {
  if (data.totalHashed === 0) return '## Asset Hashes: no hashed assets detected\n';

  if (opts.compact) {
    const dirs = data.buildDirs.length > 0 ? ` | dirs: ${data.buildDirs.join(', ')}` : '';
    const hashes = data.assets.slice(0, 5).map((a) => `${a.filename}`).join(', ');
    return `## Asset Hashes (${data.totalHashed}): ${hashes}${data.totalHashed > 5 ? '...' : ''}${dirs}\n`;
  }

  const lines = ['## Asset Hashes\n'];
  lines.push(`**${data.totalHashed} hashed assets detected**\n`);

  if (data.buildDirs.length > 0) {
    lines.push(`**Build directories:** ${data.buildDirs.map((d) => `\`${d}/\``).join(', ')}\n`);
  }

  lines.push('| Filename | Type | Hash |');
  lines.push('|----------|------|------|');
  for (const a of data.assets) {
    lines.push(`| \`${a.filename}\` | ${a.type} | \`${a.hash}\` |`);
  }
  lines.push('');

  lines.push('> Identical hashes across sites may indicate shared build output (fingerprinting vector).\n');

  return lines.join('\n');
}
