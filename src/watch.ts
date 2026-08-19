import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { existsSync, copyFileSync } from 'node:fs';
import { screenshot, type ScreenshotConfig } from './screenshot.js';
import { countChangedPixels, loadPNGFile } from './pixel-diff.js';

/**
 * Watch a directory for file changes and re-screenshot on each change.
 * Debounces rapid changes (300ms). Reports pixel diff % between captures.
 */
export function startWatch(
  watchPath: string,
  config: ScreenshotConfig,
  onCapture: (result: { imagePath: string; metaPath?: string; diffPercent?: string }) => void,
): { close: () => void } {
  const absPath = resolve(watchPath);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const prevPath = config.output.replace(/\.(png|jpg|jpeg)$/, '-prev$&');

  async function capture(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // Save previous screenshot for diff
      const hasPrev = existsSync(config.output);
      if (hasPrev) {
        copyFileSync(config.output, prevPath);
      }

      const result = await screenshot(config);
      let diffPercent: string | undefined;

      // Compute diff against previous if both exist and format is PNG
      if (hasPrev && existsSync(prevPath) && existsSync(result.imagePath) && result.imagePath.endsWith('.png')) {
        try {
          const prev = await loadPNGFile(prevPath);
          const curr = await loadPNGFile(result.imagePath);
          const diff = countChangedPixels(prev, curr);
          diffPercent = diff.changePercent;
        } catch { /* ignore diff errors */ }
      }

      onCapture({ ...result, diffPercent });
    } catch (err: any) {
      console.error(`looksy watch: ${err.message}`);
    } finally {
      running = false;
    }
  }

  const watcher = watch(absPath, { recursive: true }, (_event, filename) => {
    // Skip hidden files, node_modules, dist, .git
    if (filename && /^(\.|node_modules|dist|\.git)/.test(filename)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`looksy watch: change detected${filename ? ` (${filename})` : ''}`);
      capture();
    }, 300);
  });

  // Initial capture
  capture();

  return {
    close: () => {
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}
