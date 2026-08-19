import type { ResponsiveCheckResult } from './responsive-check.js';
import { hscrollFragment, aaFailFragment, type BriefResult } from './cli-output.js';

/**
 * Fleet-shaped finding — mirrors pulse's `Finding` (`~/git/pulse/src/types.ts`) so snuff/pulse/brief
 * read one shape: `{ id, scope, severity, title, hint? }`. Only `scope: 'site'` is ever emitted.
 */
export interface Finding {
  /** Stable across runs: `visual:<url>/<check>`. */
  id: string;
  scope: 'site';
  severity: 'crit' | 'warn';
  /** Check name + short reason (`no-hscroll: +174px at 375px`, `contrast: 2 AA fail`, `<check> failed`). */
  title: string;
  /** Flag to dig in for detail (--design, --speed, --sweep, …). */
  hint?: string;
}

export interface FindingsResult extends BriefResult {
  responsiveCheckResult?: ResponsiveCheckResult;
}

/** Flag to reach for when digging into a given check/finding name. */
const HINTS: Record<string, string> = {
  'no-hscroll': '--sweep',
  contrast: '--design',
  'heading-outline': '--design',
  'touch-targets': '--design-audit',
};

/** `contrast:aa` → `contrast`, `touch-targets:32` → `touch-targets`, `no-hscroll` → `no-hscroll`. */
function checkBaseName(assertion: string): string {
  return assertion.match(/^[^:\s]+/)?.[0] ?? assertion;
}

/**
 * Compress a failed --check's detail into a short reason for the finding title. Known verbose
 * details get a dedicated short form; anything else is passed through, trimmed to one line.
 */
function checkReason(name: string, detail: string | undefined): string | undefined {
  const d = detail?.trim();
  if (!d) return undefined;
  if (name === 'no-hscroll') {
    const over = d.match(/\(\+(\d+)px/)?.[1];
    const vw = d.match(/viewport (\d+)px/)?.[1];
    if (over && vw) return `+${over}px at ${vw}px`;
  }
  const oneLine = d.replace(/\s+/g, ' ');
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

function touchTargetFragment(result: FindingsResult): string | undefined {
  const rc = result.responsiveCheckResult;
  if (!rc) return undefined;
  const n = rc.breakpoints.reduce((sum, bp) => sum + (bp.smallTouchTargets ?? 0), 0);
  return n > 0 ? `${n} controls < ${rc.targetSize}px` : undefined;
}

/**
 * Fleet-shaped findings for `--json` (single/fleet/`--check`) — one shape for snuff/pulse/brief
 * to read instead of each parsing a different sidecar. Pure.
 */
export function toFindings(entries: Array<{ url: string; result: FindingsResult }>): Finding[] {
  const findings: Finding[] = [];
  for (const { url, result } of entries) {
    const base = url.replace(/\/+$/, '');
    const checkedNames = new Set(
      (result.checkResultsData ?? []).map((c) => checkBaseName(c.assertion)),
    );
    for (const c of result.checkResultsData ?? []) {
      if (c.pass) continue;
      const name = checkBaseName(c.assertion);
      const reason = checkReason(name, c.detail);
      findings.push({
        id: `visual:${base}/${name}`,
        scope: 'site',
        severity: 'crit',
        title: reason ? `${name}: ${reason}` : `${name} failed`,
        hint: HINTS[name],
      });
    }
    if (!checkedNames.has('contrast')) {
      const title = aaFailFragment(result);
      if (title) {
        findings.push({
          id: `visual:${base}/contrast`,
          scope: 'site',
          severity: 'warn',
          title: `contrast: ${title}`,
          hint: HINTS.contrast,
        });
      }
    }
    if (!checkedNames.has('no-hscroll')) {
      const p = result.pageInfo;
      const title =
        hscrollFragment(result) && p?.viewportWidth
          ? `+${p.width - p.viewportWidth}px at ${p.viewportWidth}px`
          : undefined;
      if (title) {
        findings.push({
          id: `visual:${base}/no-hscroll`,
          scope: 'site',
          severity: 'warn',
          title: `no-hscroll: ${title}`,
          hint: HINTS['no-hscroll'],
        });
      }
    }
    if (!checkedNames.has('touch-targets')) {
      const title = touchTargetFragment(result);
      if (title) {
        findings.push({
          id: `visual:${base}/touch-targets`,
          scope: 'site',
          severity: 'warn',
          title: `touch-targets: ${title}`,
          hint: HINTS['touch-targets'],
        });
      }
    }
  }
  return findings;
}
