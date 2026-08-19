import type { Page, Response } from 'playwright';
import { diagnoseDnsFailure } from './dns-check.js';

/** Hard ceiling on how long navigateSafe() waits specifically for `networkidle`, independent
 *  of any longer `--timeout`. A page embedding a third-party widget (chat, ads, analytics
 *  beacon) that keeps the network busy forever never reaches networkidle — without this cap
 *  the FULL --timeout would elapse before the domcontentloaded fallback even starts, turning
 *  an otherwise-fast page into a 30s+ (or longer, at higher --timeout) wait for nothing. */
export const NETWORK_IDLE_TIMEOUT_MS = 30_000;

/** Exact note surfaced to the reader when the networkidle wait itself hit the cap above
 *  (as opposed to a generic navigation failure) — pull text, not a full sentence, so callers
 *  can splice it into a Page:/status line or an errors[] entry. */
export function formatIdleTimeoutNote(): string {
  return '(timed out waiting for network idle)';
}

/** True for a Playwright navigation timeout (vs. a DNS/network failure). */
function isNavigationTimeout(err: any): boolean {
  return err?.name === 'TimeoutError' || /timeout/i.test(String(err?.message ?? ''));
}

export interface NavigateResult {
  response: Response | null;
  /** True when the initial networkidle wait hit NETWORK_IDLE_TIMEOUT_MS and navigation
   *  fell back to domcontentloaded instead of a genuine load failure. */
  idleTimedOut?: boolean;
}

/**
 * Error-resilient navigation: tries networkidle first (capped at NETWORK_IDLE_TIMEOUT_MS),
 * falls back to domcontentloaded. Returns the response (or null) plus idleTimedOut when the
 * fallback was triggered by the idle-wait cap specifically. Pushes a warning into errors[] on
 * fallback.
 */
export async function navigateSafe(
  page: Page,
  url: string,
  opts?: { timeout?: number; errors?: string[] },
): Promise<NavigateResult> {
  const timeout = opts?.timeout ?? 30000;
  const idleTimeout = Math.min(timeout, NETWORK_IDLE_TIMEOUT_MS);
  const fallbackTimeout = Math.max(timeout / 2, 15000);

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: idleTimeout });
    return { response };
  } catch (navErr: any) {
    const idleTimedOut = isNavigationTimeout(navErr);
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: fallbackTimeout,
      });
      opts?.errors?.push(
        idleTimedOut
          ? `Navigation: ${formatIdleTimeoutNote()}, fell back to domcontentloaded`
          : `Navigation: fell back to domcontentloaded (${navErr.message})`,
      );
      return { response, idleTimedOut };
    } catch (retryErr: any) {
      // Stale-DNS check: Chromium always uses the OS resolver, which can lag a fresh
      // cutover by minutes even after public DNS has the record. Confirm against 1.1.1.1
      // before throwing so the error tells you which one it is instead of just "failed".
      const hint = await diagnoseDnsFailure(url, retryErr.message);
      throw new Error(`Navigation failed: ${retryErr.message}${hint ? `\n${hint}` : ''}`);
    }
  }
}

/** Cap on waiting for web fonts to finish loading before capture — a font that never
 *  fires (blocked request, buggy `font-display`) must not hang the capture. */
const STABILIZE_FONTS_TIMEOUT_MS = 3000;

const LOOKSY_CSP_INLINE_STYLE_RE =
  /Refused to apply inline style|violates the following Content Security Policy directive.*style-src/;

/**
 * True for a CSP console error caused by looksy's own inline `<style>` injection
 * (stabilizePage's freeze rule, `--inject`, `--ignore` masks) rather than a real page bug.
 */
export function isLooksyCspError(msg: string): boolean {
  return LOOKSY_CSP_INLINE_STYLE_RE.test(msg);
}

/** Append ` (looksy)` to a console error caused by looksy's own inline style (never drop it). */
export function tagLooksyConsoleError(msg: string, looksyStyleActive: boolean): string {
  return looksyStyleActive && isLooksyCspError(msg) ? `${msg} (looksy)` : msg;
}

/**
 * Stabilize the page immediately before it's captured or analyzed: wait for web fonts
 * to finish loading (capped, so FOUT settles into its final layout) and freeze CSS
 * animations/transitions so a mid-flight frame never poisons a screenshot, contrast
 * sample, or saved baseline.
 *
 * Shared by every capture path that reuses this page afterward (main screenshot,
 * sections, meta/contrast/a11y analysis). Callers that need real motion — filmstrip,
 * video recording — must skip this.
 */
export async function stabilizePage(page: Page): Promise<void> {
  await Promise.race([
    page.evaluate(() => document.fonts.ready.then(() => undefined)),
    new Promise<void>((resolve) => setTimeout(resolve, STABILIZE_FONTS_TIMEOUT_MS)),
  ]);

  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation-play-state: paused !important; transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important; }',
  });

  // One rAF so the paused/frozen styles above are actually applied before capture.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}
