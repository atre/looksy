import type { Page } from 'playwright';
import { copyFileSync } from 'node:fs';

export interface CaptureOptions {
  outputPath: string;
  width: number;
  pageHeight: number;
  fullPage: boolean;
  maxHeight?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  selector?: string;
  selectorAll?: boolean;
}

export interface CaptureOutcome {
  selectorAllPaths?: string[];
}

/** Take the primary screenshot honoring selector, --all, --full, --max-height and fullPage timeout fallback. */
export async function captureMainScreenshot(
  page: Page,
  opts: CaptureOptions,
  consoleErrors: string[],
): Promise<CaptureOutcome> {
  const screenshotOpts: Record<string, any> = {
    path: opts.outputPath,
    fullPage: opts.fullPage,
    type: opts.format === 'jpeg' ? 'jpeg' : 'png',
  };
  if (opts.format === 'jpeg' && opts.quality) screenshotOpts.quality = opts.quality;

  if (opts.fullPage && opts.maxHeight) {
    const cappedHeight = Math.min(opts.maxHeight, opts.pageHeight);
    screenshotOpts.fullPage = false;
    screenshotOpts.clip = { x: 0, y: 0, width: opts.width, height: cappedHeight };
  }

  if (opts.selector && opts.selectorAll) {
    const elements = await page.$$(opts.selector);
    if (elements.length === 0) {
      consoleErrors.push(`Selector "${opts.selector}" not found — using viewport`);
      await page.screenshot(screenshotOpts);
      return {};
    }
    const selectorAllPaths: string[] = [];
    for (let i = 0; i < elements.length; i++) {
      const elPath = opts.outputPath.replace(/(\.[^.]+)$/, `-${i + 1}$1`);
      try {
        await elements[i].screenshot({ ...screenshotOpts, path: elPath });
        selectorAllPaths.push(elPath);
      } catch (err: any) {
        // Hidden/zero-size matches (e.g. a shared class also hitting display:none
        // templates) throw on .screenshot() — skip that one element and keep going
        // instead of stranding every PNG captured so far.
        const reason = err?.message ?? String(err);
        console.error(
          `looksy: skipped element ${i + 1} of ${elements.length} (${opts.selector}): ${reason}`,
        );
      }
    }
    if (selectorAllPaths.length === 0) {
      throw new Error(
        `All ${elements.length} elements matching "${opts.selector}" failed to capture`,
      );
    }
    copyFileSync(selectorAllPaths[0], opts.outputPath);
    return { selectorAllPaths };
  }

  if (opts.selector) {
    const element = await page.$(opts.selector);
    if (element) {
      await element.screenshot(screenshotOpts);
    } else {
      consoleErrors.push(`Selector "${opts.selector}" not found — using viewport`);
      await page.screenshot(screenshotOpts);
    }
    return {};
  }

  if (screenshotOpts.fullPage) {
    try {
      await Promise.race([
        page.screenshot(screenshotOpts),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('fullPage screenshot timeout')), 30000),
        ),
      ]);
    } catch (err: any) {
      if (err.message === 'fullPage screenshot timeout') {
        consoleErrors.push('Full-page screenshot timed out — falling back to clipped capture');
        const fallbackOpts = {
          ...screenshotOpts,
          fullPage: false,
          clip: { x: 0, y: 0, width: opts.width, height: Math.min(opts.pageHeight, 16384) },
        };
        await page.screenshot(fallbackOpts);
      } else {
        throw err;
      }
    }
    return {};
  }

  await page.screenshot(screenshotOpts);
  return {};
}
