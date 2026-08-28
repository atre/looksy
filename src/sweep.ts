import { screenshot, type ScreenshotConfig } from './screenshot.js';
import { connectOrLaunch } from './server.js';

const DEFAULT_BREAKPOINTS = [
  { name: '320', width: 320, height: 568, label: 'iPhone SE' },
  { name: '375', width: 375, height: 812, label: 'iPhone X' },
  { name: '768', width: 768, height: 1024, label: 'iPad' },
  { name: '1024', width: 1024, height: 768, label: 'Small desktop' },
  { name: '1440', width: 1440, height: 900, label: 'Large desktop' },
];

function heightForWidth(w: number): number {
  if (w <= 375) return 812;
  if (w <= 768) return 1024;
  return Math.round(w * 0.625); // 16:10
}

export interface SweepResult {
  screenshots: Array<{
    breakpoint: string;
    label: string;
    width: number;
    path: string;
    metaPath?: string;
    /** Document size at this breakpoint — width > breakpoint width means horizontal scroll. */
    pageInfo?: { width: number; height: number; title: string };
    /** AA/AAA contrast failure counts when --contrast ran. */
    contrastFailures?: { aa: number; aaa: number };
    /** One-line analyzer summaries (same as single-capture stdout). */
    analysisSummaries?: string[];
  }>;
  /** Breakpoints that failed to capture — partial results are still returned. */
  failures: Array<{ breakpoint: string; width: number; error: string }>;
}

/**
 * Run screenshots at responsive breakpoints (default 5, or custom).
 * Uses a shared browser with parallel contexts for speed.
 */
export async function responsiveSweep(
  baseConfig: Omit<ScreenshotConfig, 'width' | 'height' | 'output'>,
  outputBase: string,
  customBreakpoints?: number[],
): Promise<SweepResult> {
  const breakpoints = customBreakpoints
    ? customBreakpoints.map((w) => ({
        name: String(w),
        width: w,
        height: heightForWidth(w),
        label: `${w}px`,
      }))
    : DEFAULT_BREAKPOINTS;

  const baseName = outputBase.replace(/\.(png|jpg|jpeg)$/, '');
  const { browser, owned } = await connectOrLaunch({
    hostResolverRule: baseConfig.hostResolverRule,
  });

  try {
    // Per-breakpoint isolation: one failed width must not abort the others.
    const settled = await Promise.all(
      breakpoints.map(async (bp) => {
        const output = `${baseName}-${bp.name}.png`;
        try {
          const result = await screenshot({
            ...baseConfig,
            width: bp.width,
            height: bp.height,
            output,
            browser,
          });
          return {
            ok: true as const,
            shot: {
              breakpoint: bp.name,
              label: bp.label,
              width: bp.width,
              path: result.imagePath,
              metaPath: result.metaPath,
              pageInfo: result.pageInfo,
              contrastFailures: result.contrastFailures,
              analysisSummaries: result.analysisSummaries,
            },
          };
        } catch (err) {
          return {
            ok: false as const,
            failure: {
              breakpoint: bp.name,
              width: bp.width,
              error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }),
    );

    const screenshots: SweepResult['screenshots'] = [];
    const failures: SweepResult['failures'] = [];
    for (const s of settled) {
      if (s.ok) screenshots.push(s.shot);
      else failures.push(s.failure);
    }
    if (screenshots.length === 0) {
      throw new Error(
        `sweep: all ${breakpoints.length} breakpoints failed — first error: ${failures[0].error}`,
      );
    }
    return { screenshots, failures };
  } finally {
    await browser.close();
  }
}
