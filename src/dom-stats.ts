import type { Page } from 'playwright';

export interface DomStatsData {
  totalElements: number;
  maxDepth: number;
  inlineStyles: number;
}

/**
 * Extract DOM complexity stats: total elements, max nesting depth, inline style count.
 */
export async function extractDomStats(page: Page): Promise<DomStatsData> {
  return await page.evaluate(() => {
    let totalElements = 0;
    let maxDepth = 0;
    let inlineStyles = 0;

    // Iterative traversal to avoid named function inside evaluate
    // (esbuild keepNames wraps named functions with __name() which breaks in browser context)
    const stack: Array<[Element, number]> = [[document.documentElement, 0]];
    while (stack.length > 0) {
      const [el, depth] = stack.pop()!;
      totalElements++;
      if (depth > maxDepth) maxDepth = depth;
      if (el.hasAttribute('style')) inlineStyles++;
      if (depth < 512) {
        for (const child of el.children) stack.push([child, depth + 1]);
      }
    }

    return { totalElements, maxDepth, inlineStyles };
  });
}

export function formatDomStats(stats: DomStatsData, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    return `## DOM: ${stats.totalElements} elements, depth ${stats.maxDepth}, ${stats.inlineStyles} inline styles\n`;
  }
  const lines = ['## DOM Statistics\n'];
  lines.push(`- **Total elements:** ${stats.totalElements}`);
  lines.push(`- **Max nesting depth:** ${stats.maxDepth}`);
  lines.push(`- **Inline styles:** ${stats.inlineStyles}`);
  lines.push('');
  return lines.join('\n');
}
