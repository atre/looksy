import type { Browser } from 'playwright';
import { withBrowser } from './server.js';
import { navigateSafe } from './navigate.js';
import { extractContrast, type ContrastPairResult } from './contrast.js';
import { prepareContext, dismissConsent, type PagePrepOptions } from './page-prep.js';

export interface TouchTargetDetail {
  tag: string;
  text: string;
  className: string;
  width: number;
  height: number;
  /** Whether this is an inline link within a text block (WCAG 2.5.8 exemption) */
  inlineExempt: boolean;
}

export interface TinyTextDetail {
  tag: string;
  text: string;
  className: string;
  fontSize: number;
}

export interface OverflowCulprit {
  tag: string;
  text: string;
  right: number;
  className: string;
}

interface BreakpointResult {
  width: number;
  label: string;
  issues: Array<{ severity: 'HIGH' | 'MEDIUM' | 'LOW'; message: string }>;
  hasHorizontalOverflow: boolean;
  /** Document scrollWidth at this breakpoint (overflow amount = scrollWidth - width). */
  scrollWidth?: number;
  /** Top-3 elements/text whose own box extends past the viewport, by right edge (outermost wins). */
  overflowCulprits?: OverflowCulprit[];
  smallTouchTargets: number;
  /** Small inline text links (WCAG 2.5.8 exempt) — reported separately, never counted as failures. */
  smallTextLinks?: number;
  tinyText: number;
  pageHeight: number;
  /** Per-element touch target details */
  touchTargetDetails: TouchTargetDetail[];
  /** Per-element tiny text details */
  tinyTextDetails: TinyTextDetail[];
  /** AA contrast failures at this breakpoint (undefined if contrast not sampled) */
  contrastAaFailures?: number;
  /** Failing contrast pairs at this breakpoint */
  contrastDetails?: ContrastPairResult[];
}

export interface ResponsiveCheckResult {
  breakpoints: BreakpointResult[];
  totalIssues: number;
  /** The target size threshold used (default 44) */
  targetSize: number;
}

export interface ResponsiveCheckOptions {
  /** Minimum touch target size in px (default 44, WCAG 2.5.5 AAA; use 24 for WCAG 2.5.8 AA) */
  targetSize?: number;
  /** Skip hidden/sr-only elements */
  visibleOnly?: boolean;
  /** Also sample WCAG contrast at each breakpoint (catches mobile-only contrast issues) */
  contrast?: boolean;
  /** Max elements sampled per breakpoint for contrast (default 150) */
  contrastLimit?: number;
  /** Hard deadline per breakpoint in ms (default 90000). page.evaluate has no Playwright
   *  timeout, so a degenerate DOM scan would otherwise hang the CLI forever. */
  breakpointTimeoutMs?: number;
  /** Navigation timeout per breakpoint (default 30000). */
  timeout?: number;
  /** --cookie: same request cookies as the main capture. */
  cookie?: string;
  /** --local-storage: same localStorage seed as the main capture. */
  localStorage?: string;
  /** --dismiss-consent: dismiss CMP banners in each breakpoint context too. */
  dismissConsent?: boolean;
}

const BREAKPOINTS = [
  { width: 375, height: 812, label: 'Mobile' },
  { width: 768, height: 1024, label: 'Tablet' },
  { width: 1440, height: 900, label: 'Desktop' },
];

/**
 * Run responsive audit at 3 breakpoints with a shared browser.
 * Checks for overflow, touch targets, text readability.
 */
export async function runResponsiveCheck(
  url: string,
  browser?: Browser,
  opts?: ResponsiveCheckOptions,
): Promise<ResponsiveCheckResult> {
  const targetSize = opts?.targetSize ?? 44;
  const visibleOnly = opts?.visibleOnly ?? false;
  const sampleContrast = opts?.contrast ?? false;
  const contrastLimit = opts?.contrastLimit;
  const breakpointTimeoutMs = opts?.breakpointTimeoutMs ?? 90_000;
  const navTimeout = opts?.timeout ?? 30000;
  const prep: PagePrepOptions = {
    cookie: opts?.cookie,
    localStorage: opts?.localStorage,
    dismissConsent: opts?.dismissConsent,
  };
  // No browser passed in → acquire one via withBrowser, which always releases it (a
  // connected --serve browser must be disconnected too, or the CLI never exits).
  if (!browser) {
    return withBrowser((b) => runResponsiveCheck(url, b, opts));
  }
  const resolvedBrowser = browser;

  {
    const breakpointResults = await Promise.all(
      BREAKPOINTS.map(async (bp) => {
        const context = await resolvedBrowser.newContext({
          viewport: { width: bp.width, height: bp.height },
        });
        await prepareContext(context, url, prep);
        const page = await context.newPage();

        // Closing the context is the only way to abort an in-flight page.evaluate —
        // it has no Playwright timeout of its own. Without this, a degenerate scan
        // (huge, continuously-animating DOM) hangs the whole CLI indefinitely.
        let timedOut = false;
        const killer = setTimeout(() => {
          timedOut = true;
          void context.close().catch(() => {});
        }, breakpointTimeoutMs);

        try {
          await navigateSafe(page, url, { timeout: navTimeout });
          if (prep.dismissConsent) await dismissConsent(page);

          const checkTouchTargets = bp.width <= 768;
          const checkTinyText = bp.width <= 375;

          const metrics = await page.evaluate(
            (args: {
              viewportWidth: number;
              doCheckTouchTargets: boolean;
              doCheckTinyText: boolean;
              minTargetSize: number;
              filterVisible: boolean;
            }) => {
              const docEl = document.documentElement;
              const hasHorizontalOverflow = docEl.scrollWidth > args.viewportWidth;

              // Name the overflow culprit: top-3 elements/text whose own box extends past the
              // viewport, by right edge. Walks elements + text ranges (Range.getClientRects()
              // catches nowrap text overflowing without its element's own box growing), then
              // dedupes parent/child — an ancestor whose box also overflows only gets reported
              // once, as the outermost offender; descendants it contains are skipped.
              const overflowCulprits: Array<{
                tag: string;
                text: string;
                right: number;
                className: string;
              }> = [];
              if (hasHorizontalOverflow) {
                type Culprit = { el: Element; right: number; text: string };
                const candidates: Culprit[] = [];
                for (const el of document.querySelectorAll('*')) {
                  const rect = el.getBoundingClientRect();
                  if (rect.right > args.viewportWidth) {
                    candidates.push({
                      el,
                      right: rect.right,
                      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
                    });
                  }
                }
                const walker = document.createTreeWalker(
                  document.body || docEl,
                  NodeFilter.SHOW_TEXT,
                );
                let textNode: Node | null;
                while ((textNode = walker.nextNode())) {
                  const raw = textNode.textContent;
                  if (!raw || !raw.trim()) continue;
                  const parent = textNode.parentElement;
                  if (!parent) continue;
                  const range = document.createRange();
                  range.selectNodeContents(textNode);
                  let maxRight = 0;
                  for (const r of range.getClientRects()) {
                    if (r.right > maxRight) maxRight = r.right;
                  }
                  if (maxRight > args.viewportWidth) {
                    candidates.push({
                      el: parent,
                      right: maxRight,
                      text: raw.replace(/\s+/g, ' ').trim(),
                    });
                  }
                }
                const depthOf = (el: Element): number => {
                  let d = 0;
                  for (let p = el.parentElement; p; p = p.parentElement) d++;
                  return d;
                };
                candidates.sort((a, b) => depthOf(a.el) - depthOf(b.el));
                const selected: Culprit[] = [];
                for (const c of candidates) {
                  if (selected.some((s) => s.el === c.el || s.el.contains(c.el))) continue;
                  selected.push(c);
                }
                selected.sort((a, b) => b.right - a.right);
                for (const c of selected.slice(0, 3)) {
                  overflowCulprits.push({
                    tag: c.el.tagName.toLowerCase(),
                    text: c.text.slice(0, 40),
                    right: Math.round(c.right),
                    className: (c.el.getAttribute('class') || '').trim().slice(0, 80),
                  });
                }
              }

              // Inline visibility check — same pattern as contrast.ts
              // (no named functions inside evaluate to avoid esbuild __name() issue)
              // Memoized top-down: each element/ancestor is styled exactly once. The
              // previous per-element ancestor walk did getComputedStyle + layout reads
              // per step — O(n·depth) forced reflows, which degenerated into 40-minute
              // evaluates on large pages with running CSS animations.
              const hiddenCache = new Map<Element, boolean>();
              const fadedCache = new Map<Element, boolean>();
              // display:none / visibility:hidden / zero-size elements are never real touch
              // targets at the current breakpoint — excluded unconditionally.
              const selfHidden = (el: Element): boolean => {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return true;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return true;
                return false;
              };
              const isHidden = (el: Element): boolean => {
                const hit = hiddenCache.get(el);
                if (hit !== undefined) return hit;
                const v = selfHidden(el) || (el.parentElement ? isHidden(el.parentElement) : false);
                hiddenCache.set(el, v);
                return v;
              };

              // opacity:0 / clipped-to-1px elements may still be intentionally revealed later
              // (transitions, hover/focus states) — only excluded when --visible-only opts in.
              const selfFaded = (el: Element): boolean => {
                const cs = getComputedStyle(el);
                if (cs.opacity === '0') return true;
                if (
                  cs.position === 'absolute' &&
                  cs.overflow === 'hidden' &&
                  (parseInt(cs.width) <= 1 || parseInt(cs.height) <= 1)
                )
                  return true;
                return false;
              };
              const isFaded = (el: Element): boolean => {
                const hit = fadedCache.get(el);
                if (hit !== undefined) return hit;
                const v = selfFaded(el) || (el.parentElement ? isFaded(el.parentElement) : false);
                fadedCache.set(el, v);
                return v;
              };

              // Detect sr-only / visually-hidden / focus-only elements. These are clipped out
              // of normal flow (rendered ~1px, off-screen) and only surface on focus, so they
              // are never real touch targets — exclude them regardless of --visible-only.
              const srCache = new Map<Element, boolean>();
              const selfSrOnly = (el: Element): boolean => {
                const cls = el.getAttribute ? el.getAttribute('class') || '' : '';
                if (
                  /(^|[\s_-])(sr[-_]?only|visually[-]?hidden|screen[-]?reader[-\w]*)([\s_-]|$)/i.test(
                    cls,
                  )
                )
                  return true;
                const cs = getComputedStyle(el);
                if (
                  (cs.position === 'absolute' || cs.position === 'fixed') &&
                  cs.overflow === 'hidden' &&
                  (parseInt(cs.width) <= 1 || parseInt(cs.height) <= 1)
                )
                  return true;
                if (cs.clip && cs.clip !== 'auto' && /rect\(\s*0/i.test(cs.clip)) return true;
                if (cs.clipPath && /inset\(\s*50%/i.test(cs.clipPath)) return true;
                return false;
              };
              const isSrOnly = (el: Element): boolean => {
                const hit = srCache.get(el);
                if (hit !== undefined) return hit;
                const v = selfSrOnly(el) || (el.parentElement ? isSrOnly(el.parentElement) : false);
                srCache.set(el, v);
                return v;
              };

              // Focus-only elements (skip links, off-canvas nav triggers): rendered off-screen
              // or unreachable in normal flow, only surface on keyboard focus — not a real tap
              // target either. Distinct from isSrOnly's clip/1px pattern.
              const isFocusOnly = (el: Element): boolean => {
                const cls = el.getAttribute ? el.getAttribute('class') || '' : '';
                if (/skip[-_]?(link|to|nav)/i.test(cls)) return true;
                const cs = getComputedStyle(el);
                if ((el as HTMLElement).offsetParent === null && cs.position !== 'fixed')
                  return true;
                const rect = el.getBoundingClientRect();
                if (rect.right <= 0 || rect.bottom <= 0) return true;
                return false;
              };

              // A nav-region <a> (inside nav / [role=navigation] / header) is a control, not
              // inline text — even when it's laid out `display: inline` next to other links.
              const isNavLink = (el: Element): boolean =>
                el.tagName === 'A' && !!el.closest('nav, [role="navigation"], header');

              // Inline text link (WCAG 2.5.8 "inline" exception): an <a> laid out as inline
              // text — its size is constrained by the line box, not by a control's padding.
              // Breadcrumb crumbs, footer link lists, tag chips rendered as plain inline <a>
              // all fall here; counting them as failed controls made "65 targets < 44px"
              // roughly half noise. Block/inline-block/flex anchors are still real controls.
              const isInlineLink = (el: Element): boolean => {
                if (el.tagName !== 'A') return false;
                if (isNavLink(el)) return false;
                if (getComputedStyle(el).display === 'inline') return true;
                const parent = el.parentElement;
                if (!parent) return false;
                const parentTag = parent.tagName;
                // Inline if parent is a text-flow element
                if (
                  parentTag === 'P' ||
                  parentTag === 'LI' ||
                  parentTag === 'SPAN' ||
                  parentTag === 'TD' ||
                  parentTag === 'TH' ||
                  parentTag === 'LABEL' ||
                  parentTag === 'BLOCKQUOTE' ||
                  parentTag === 'DD'
                ) {
                  // Confirm it has text siblings (not the sole child)
                  const parentText = (parent.textContent || '').trim();
                  const elText = (el.textContent || '').trim();
                  if (parentText.length > elText.length) return true;
                }
                return false;
              };

              // Accessible name fallback: an icon-only button/link has no textContent but
              // may still be labeled via aria-label/title/aria-labelledby — report that
              // instead of an empty "" that hides which control is actually broken.
              const accessibleText = (el: Element): string => {
                const own = (el.textContent || '').trim();
                if (own) return own;
                const ariaLabel = (el.getAttribute('aria-label') || '').trim();
                if (ariaLabel) return ariaLabel;
                const title = (el.getAttribute('title') || '').trim();
                if (title) return title;
                const labelledBy = el.getAttribute('aria-labelledby');
                if (labelledBy) {
                  const text = labelledBy
                    .split(/\s+/)
                    .map((id) => (document.getElementById(id)?.textContent || '').trim())
                    .filter(Boolean)
                    .join(' ');
                  if (text) return text;
                }
                return '';
              };

              const touchTargetDetails: Array<{
                tag: string;
                text: string;
                className: string;
                width: number;
                height: number;
                inlineExempt: boolean;
              }> = [];

              if (args.doCheckTouchTargets) {
                const clickableSelector =
                  'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"]';
                for (const el of document.querySelectorAll(clickableSelector)) {
                  if (isSrOnly(el) || isFocusOnly(el) || isHidden(el)) continue; // not a real tap target
                  if (args.filterVisible && isFaded(el)) continue;
                  const rect = el.getBoundingClientRect();
                  if (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    (rect.width < args.minTargetSize || rect.height < args.minTargetSize)
                  ) {
                    const text = accessibleText(el).slice(0, 50);
                    const className = (el.getAttribute('class') || '').trim().slice(0, 80);
                    touchTargetDetails.push({
                      tag: isNavLink(el) ? 'nav a' : el.tagName.toLowerCase(),
                      text,
                      className,
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                      inlineExempt: isInlineLink(el),
                    });
                  }
                }
              }

              const tinyTextDetails: Array<{
                tag: string;
                text: string;
                className: string;
                fontSize: number;
              }> = [];

              if (args.doCheckTinyText) {
                const textSelector = 'p, span, a, li, td, th, label, div, h1, h2, h3, h4, h5, h6';
                const candidates = Array.from(document.querySelectorAll(textSelector));
                // "Wraps other text elements" test without an O(n²) per-element subtree
                // query: mark every ancestor of each inner text element once, then a
                // container is simply any element in the set.
                const wrapsText = new Set<Element>();
                for (const el of candidates) {
                  const tag = el.tagName;
                  // Same inner-element set as the old subtree query: p/span/a/li/h1-h6
                  if (tag === 'DIV' || tag === 'TD' || tag === 'TH' || tag === 'LABEL') continue;
                  let p = el.parentElement;
                  while (p && !wrapsText.has(p)) {
                    wrapsText.add(p);
                    p = p.parentElement;
                  }
                }
                for (const el of candidates) {
                  // Skip containers that just wrap other text elements
                  if (wrapsText.has(el)) continue;
                  if (isHidden(el)) continue;
                  if (args.filterVisible && isFaded(el)) continue;
                  const text = accessibleText(el);
                  if (!text) continue;
                  const fs = parseFloat(getComputedStyle(el).fontSize);
                  if (!isNaN(fs) && fs > 0 && fs < 12) {
                    tinyTextDetails.push({
                      tag: el.tagName.toLowerCase(),
                      text: text.slice(0, 50),
                      className: (el.getAttribute('class') || '').trim().slice(0, 80),
                      fontSize: Math.round(fs * 10) / 10,
                    });
                  }
                }
              }

              const pageHeight = Math.max(
                docEl.scrollHeight,
                document.body ? document.body.scrollHeight : 0,
              );

              return {
                scrollWidth: docEl.scrollWidth,
                hasHorizontalOverflow,
                overflowCulprits,
                touchTargetDetails,
                tinyTextDetails,
                pageHeight,
              };
            },
            {
              viewportWidth: bp.width,
              doCheckTouchTargets: checkTouchTargets,
              doCheckTinyText: checkTinyText,
              minTargetSize: targetSize,
              filterVisible: visibleOnly,
            },
          );

          // Count non-exempt touch targets for the summary
          const nonExemptTargets = metrics.touchTargetDetails.filter((t) => !t.inlineExempt);

          const issues: BreakpointResult['issues'] = [];

          if (metrics.hasHorizontalOverflow) {
            const culpritNote =
              metrics.overflowCulprits.length > 0
                ? ` — ${metrics.overflowCulprits.map((c) => `${c.tag} right=${c.right}px "${c.text}"`).join(', ')}`
                : '';
            issues.push({
              severity: 'HIGH',
              message: `Horizontal overflow: page ${metrics.scrollWidth}px is ${metrics.scrollWidth - bp.width}px wider than the ${bp.width}px viewport (horizontal scroll)${culpritNote}`,
            });
          }

          if (nonExemptTargets.length > 0) {
            const textLinks = metrics.touchTargetDetails.length - nonExemptTargets.length;
            issues.push({
              severity: 'MEDIUM',
              message: `${nonExemptTargets.length} control${nonExemptTargets.length > 1 ? 's' : ''} smaller than ${targetSize}px minimum${textLinks > 0 ? ` (+${textLinks} inline text link${textLinks > 1 ? 's' : ''}, exempt)` : ''}`,
            });
          }

          if (metrics.tinyTextDetails.length > 0) {
            issues.push({
              severity: 'LOW',
              message: `${metrics.tinyTextDetails.length} text element${metrics.tinyTextDetails.length > 1 ? 's' : ''} below 12px font size`,
            });
          }

          // Per-breakpoint contrast sampling — catches issues only present at mobile/tablet
          // widths (reflowed backgrounds, responsive color tokens) that a desktop-only pass misses.
          let contrastAaFailures: number | undefined;
          let contrastDetails: ContrastPairResult[] | undefined;
          if (sampleContrast) {
            try {
              const cr = await extractContrast(page, {
                compact: true,
                visibleOnly,
                limit: contrastLimit,
              });
              contrastAaFailures = cr.aaFailures;
              contrastDetails = cr.pairs.filter((p) => !p.aaPass);
              if (cr.aaFailures > 0) {
                issues.push({
                  severity: 'HIGH',
                  message: `${cr.aaFailures} AA contrast failure${cr.aaFailures > 1 ? 's' : ''}`,
                });
              }
            } catch {
              /* best-effort */
            }
          }

          return {
            width: bp.width,
            label: bp.label,
            issues,
            hasHorizontalOverflow: metrics.hasHorizontalOverflow,
            scrollWidth: metrics.scrollWidth,
            overflowCulprits: metrics.overflowCulprits,
            smallTouchTargets: nonExemptTargets.length,
            smallTextLinks: metrics.touchTargetDetails.length - nonExemptTargets.length,
            tinyText: metrics.tinyTextDetails.length,
            pageHeight: metrics.pageHeight,
            touchTargetDetails: metrics.touchTargetDetails,
            tinyTextDetails: metrics.tinyTextDetails,
            contrastAaFailures,
            contrastDetails,
          } satisfies BreakpointResult;
        } catch (err) {
          // Per-breakpoint isolation: a nav/eval failure at one width must not
          // kill the whole check — report it as a finding and keep going.
          const message = timedOut
            ? `Responsive check timed out after ${Math.round(breakpointTimeoutMs / 1000)}s at ${bp.width}px — DOM too large or continuously animating; try --visible-only`
            : `Responsive check failed at ${bp.width}px: ${err instanceof Error ? err.message : String(err)}`;
          return {
            width: bp.width,
            label: bp.label,
            issues: [
              {
                severity: 'HIGH',
                message,
              },
            ] as BreakpointResult['issues'],
            hasHorizontalOverflow: false,
            smallTouchTargets: 0,
            tinyText: 0,
            pageHeight: 0,
            touchTargetDetails: [],
            tinyTextDetails: [],
          } satisfies BreakpointResult;
        } finally {
          clearTimeout(killer);
          await context.close().catch(() => {});
        }
      }),
    );

    // Flag if mobile page height is >2x desktop height
    const mobile = breakpointResults.find((r) => r.width === 375);
    const desktop = breakpointResults.find((r) => r.width === 1440);
    if (mobile && desktop && desktop.pageHeight > 0 && mobile.pageHeight > desktop.pageHeight * 2) {
      mobile.issues.push({
        severity: 'MEDIUM',
        message: `Mobile page height (${mobile.pageHeight}px) is more than 2× desktop height (${desktop.pageHeight}px) — possible layout reflow issue`,
      });
    }

    const totalIssues = breakpointResults.reduce((sum, bp) => sum + bp.issues.length, 0);

    return { breakpoints: breakpointResults, totalIssues, targetSize };
  }
}

interface AggTouchTarget extends TouchTargetDetail {
  /** Breakpoint widths at which this same element was flagged. */
  breakpoints: number[];
}

interface AggContrast extends ContrastPairResult {
  breakpoints: number[];
}

/** Render the breakpoint list for an aggregated finding. */
const bpNote = (bps: number[]): string => ` — at ${bps.map((w) => `${w}px`).join(', ')}`;

/**
 * Collapse touch targets that recur across breakpoints into one finding each. The same nav link
 * is flagged at both 375px and 768px; reporting it twice inflates counts and makes cross-site
 * comparison noisy. Keyed by tag/text/class; keeps the smallest observed dimensions.
 */
function aggregateTouchTargets(breakpoints: BreakpointResult[]): AggTouchTarget[] {
  const map = new Map<string, AggTouchTarget>();
  for (const bp of breakpoints) {
    for (const t of bp.touchTargetDetails) {
      const key = `${t.tag}|${t.text}|${t.className}|${t.inlineExempt}`;
      const ex = map.get(key);
      if (ex) {
        if (!ex.breakpoints.includes(bp.width)) ex.breakpoints.push(bp.width);
        ex.width = Math.min(ex.width, t.width);
        ex.height = Math.min(ex.height, t.height);
      } else {
        map.set(key, { ...t, breakpoints: [bp.width] });
      }
    }
  }
  return [...map.values()];
}

/** Collapse identical contrast failures across breakpoints, keyed by element + color pair. */
function aggregateContrast(breakpoints: BreakpointResult[]): AggContrast[] {
  const map = new Map<string, AggContrast>();
  for (const bp of breakpoints) {
    for (const c of bp.contrastDetails || []) {
      const key = `${c.tag}|${c.text}|${c.color}|${c.bg}`;
      const ex = map.get(key);
      if (ex) {
        if (!ex.breakpoints.includes(bp.width)) ex.breakpoints.push(bp.width);
        ex.ratio = Math.min(ex.ratio, c.ratio);
      } else {
        map.set(key, { ...c, breakpoints: [bp.width] });
      }
    }
  }
  return [...map.values()];
}

/**
 * Format responsive check results.
 */
export function formatResponsiveCheck(
  result: ResponsiveCheckResult,
  opts: { compact?: boolean; limit?: number } = {},
): string {
  const compact = opts.compact ?? false;
  const targetSize = result.targetSize ?? 44;
  // Compact list cap — raise with --limit; the full list is always in the non-compact section.
  const limit = opts.limit ?? 5;

  if (compact) {
    if (result.totalIssues === 0) {
      return '## Responsive: No issues\n';
    }
    const lines: string[] = [`## Responsive: ${result.totalIssues} issue(s)`];
    for (const bp of result.breakpoints) {
      if (bp.issues.length === 0 && !bp.hasHorizontalOverflow) continue;
      if (bp.issues.length > 0) {
        lines.push(
          `- ${bp.width}px (${bp.label}): ${bp.issues.length} issue(s) — ${bp.issues.map((i) => i.message).join('; ')}`,
        );
      }
      if (bp.hasHorizontalOverflow) {
        for (const c of bp.overflowCulprits ?? []) {
          lines.push(`  overflow: ${c.tag} right=${c.right}px "${c.text}"`);
        }
      }
    }
    // Top N touch targets, deduped across breakpoints (the same link recurs at 375/768).
    const aggNonExempt = aggregateTouchTargets(result.breakpoints).filter((t) => !t.inlineExempt);
    for (const t of aggNonExempt.slice(0, limit)) {
      const cls = t.className ? ` .${t.className.split(' ')[0]}` : '';
      lines.push(
        `  ${t.tag} ${t.width}x${t.height}px "${t.text.slice(0, 30)}"${cls}${bpNote(t.breakpoints)}`,
      );
    }
    if (aggNonExempt.length > limit) {
      lines.push(`  … and ${aggNonExempt.length - limit} more (raise with --limit N)`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines: string[] = ['## Responsive Check\n'];

  const hasContrast = result.breakpoints.some((bp) => bp.contrastAaFailures !== undefined);

  // Summary table
  lines.push(
    `| Breakpoint | Overflow | Touch Targets | Tiny Text |${hasContrast ? ' Contrast AA |' : ''} Issues |`,
  );
  lines.push(
    `|------------|----------|---------------|-----------|${hasContrast ? '-------------|' : ''}--------|`,
  );
  for (const bp of result.breakpoints) {
    const overflow = bp.hasHorizontalOverflow
      ? `**YES${bp.scrollWidth ? ` (+${bp.scrollWidth - bp.width}px)` : ''}**`
      : 'no';
    const nonExemptCount = bp.touchTargetDetails.filter((t) => !t.inlineExempt).length;
    const touch = nonExemptCount > 0 ? `**${nonExemptCount} < ${targetSize}px**` : '0';
    const tiny = bp.tinyText > 0 ? `**${bp.tinyText} < 12px**` : '0';
    const issueCount = bp.issues.length > 0 ? `**${bp.issues.length}**` : '0';
    const contrastCol = hasContrast
      ? ` ${bp.contrastAaFailures === undefined ? '—' : bp.contrastAaFailures > 0 ? `**${bp.contrastAaFailures} fail**` : '0'} |`
      : '';
    lines.push(
      `| ${bp.width}px (${bp.label}) | ${overflow} | ${touch} | ${tiny} |${contrastCol} ${issueCount} |`,
    );
  }
  lines.push('');

  // Issues list
  const allIssues = result.breakpoints.flatMap((bp) =>
    bp.issues.map((issue) => ({ width: bp.width, label: bp.label, ...issue })),
  );

  const overflowBps = result.breakpoints.filter(
    (bp) => bp.hasHorizontalOverflow && bp.overflowCulprits && bp.overflowCulprits.length > 0,
  );

  if (allIssues.length === 0 && overflowBps.length === 0) {
    lines.push('No responsive issues detected.\n');
    return lines.join('\n');
  }

  if (allIssues.length > 0) {
    lines.push('### Issues\n');
    for (const issue of allIssues) {
      lines.push(`- [${issue.severity}] ${issue.width}px (${issue.label}): ${issue.message}`);
    }
    lines.push('');
  }

  // Overflow culprits per breakpoint — the top-3 elements/text actually causing the hscroll.
  if (overflowBps.length > 0) {
    lines.push('### Horizontal Overflow\n');
    for (const bp of overflowBps) {
      lines.push(`- ${bp.width}px (${bp.label}):`);
      for (const c of bp.overflowCulprits!) {
        lines.push(`  overflow: ${c.tag} right=${c.right}px "${c.text}"`);
      }
    }
    lines.push('');
  }

  // Touch target details, deduped across breakpoints (same element flagged at 375 + 768
  // collapses to one finding listing the breakpoints).
  const aggTargets = aggregateTouchTargets(result.breakpoints);
  const aggNonExempt = aggTargets.filter((t) => !t.inlineExempt);
  const aggExempt = aggTargets.filter((t) => t.inlineExempt);

  if (aggNonExempt.length > 0) {
    lines.push(`### Touch Targets (< ${targetSize}px)\n`);
    for (const t of aggNonExempt) {
      const cls = t.className ? ` class="${t.className}"` : '';
      lines.push(
        `- MEDIUM: Touch target ${t.width}x${t.height}px — <${t.tag}${cls}> "${t.text}"${bpNote(t.breakpoints)}`,
      );
    }
    lines.push('');
  }

  if (aggExempt.length > 0) {
    lines.push(`### Inline Text Links < ${targetSize}px (WCAG 2.5.8 exempt — not counted)\n`);
    for (const t of aggExempt) {
      lines.push(
        `- OK: Inline link ${t.width}x${t.height}px — <${t.tag}> "${t.text}" (inline, likely exempt)${bpNote(t.breakpoints)}`,
      );
    }
    lines.push('');
  }

  // Contrast failure details, deduped across breakpoints.
  const aggContrast = aggregateContrast(result.breakpoints);
  if (aggContrast.length > 0) {
    lines.push('### Contrast Failures\n');
    for (const c of aggContrast) {
      const cls = c.className ? ` class="${c.className.split(/\s+/).slice(0, 2).join(' ')}"` : '';
      lines.push(
        `- AA: ${c.ratio.toFixed(1)}:1 — <${c.tag}${cls}> "${c.text}" (${c.color} on ${c.bg})${bpNote(c.breakpoints)}`,
      );
    }
    lines.push('');
  }

  // Tiny text details per breakpoint
  for (const bp of result.breakpoints) {
    if (bp.tinyTextDetails.length === 0) continue;
    lines.push(`### Tiny Text — ${bp.width}px (${bp.label})\n`);
    for (const t of bp.tinyTextDetails) {
      const cls = t.className ? ` class="${t.className}"` : '';
      lines.push(`- LOW: ${t.fontSize}px text — <${t.tag}${cls}> "${t.text}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
