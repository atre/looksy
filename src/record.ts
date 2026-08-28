import { connectOrLaunch } from './server.js';
import { navigateSafe } from './navigate.js';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RecordOptions {
  duration: number; // ms
  width: number;
  height: number;
  darkMode?: boolean;
}

/**
 * Record a video of the page using Playwright's recordVideo context option.
 */
export async function recordVideo(
  url: string,
  outputPath: string,
  opts: RecordOptions,
): Promise<string> {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { browser, owned } = await connectOrLaunch();

  try {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      colorScheme: opts.darkMode ? 'dark' : 'light',
      recordVideo: { dir, size: { width: opts.width, height: opts.height } },
    });

    const page = await context.newPage();
    await navigateSafe(page, url, { timeout: 30000 });
    await page.waitForTimeout(opts.duration);

    // Get video reference before close (page.video() unreliable after context.close())
    const video = page.video();

    // Close to finalize video
    await context.close();
    if (video) {
      const savedPath = await video.path();
      // Rename to desired output
      const { renameSync } = await import('node:fs');
      try {
        renameSync(savedPath, outputPath);
      } catch {
        // Cross-device move — copy instead
        const { copyFileSync, unlinkSync } = await import('node:fs');
        copyFileSync(savedPath, outputPath);
        unlinkSync(savedPath);
      }
    }

    return outputPath;
  } finally {
    await browser.close();
  }
}
