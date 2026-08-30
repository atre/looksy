import type { Page } from 'playwright';

export interface MotionEntry {
  selector: string;
  kind: 'animation' | 'transition';
  name: string;
  durationMs: number;
  iterations: number | 'infinite';
  properties: string[];
}

export interface MotionAudit {
  entries: MotionEntry[];
  layoutRisk: MotionEntry[];
  infinite: MotionEntry[];
  long: MotionEntry[];
  reducedMotionRespected: boolean | null;
  truncated: boolean;
}

const LAYOUT_EXACT = new Set([
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'flex-basis',
  'font-size',
  'gap',
  'inset',
]);
const LAYOUT_PREFIXES = ['margin', 'padding', 'inset-'];

export function classifyProperties(props: string[]): { compositor: string[]; layout: string[] } {
  const compositor: string[] = [];
  const layout: string[] = [];
  for (const p of props) {
    const isLayout = LAYOUT_EXACT.has(p) || LAYOUT_PREFIXES.some((prefix) => p.startsWith(prefix));
    (isLayout ? layout : compositor).push(p);
  }
  return { compositor, layout };
}

export function buildMotionAudit(
  entries: MotionEntry[],
  reducedMotionRespected: boolean | null,
  truncated = false,
): MotionAudit {
  return {
    entries,
    layoutRisk: entries.filter(
      (e) => e.kind === 'transition' && classifyProperties(e.properties).layout.length > 0,
    ),
    infinite: entries.filter((e) => e.iterations === 'infinite'),
    long: entries.filter((e) => e.durationMs > 1000),
    reducedMotionRespected,
    truncated,
  };
}

const MAX_ELEMENTS_SCANNED = 1500;
const REDUCED_MOTION_DURATION_THRESHOLD_MS = 50;

interface RawMotionEntry {
  selector: string;
  kind: 'animation' | 'transition';
  name: string;
  durationMs: number;
  iterations: number | 'infinite';
  properties: string[];
}

/**
 * Inventory running animations/transitions plus declared-but-idle transitions, then probe
 * whether prefers-reduced-motion actually stops them. Fails soft: a page error yields an
 * empty audit rather than throwing, matching how other analyzers degrade (see safeRun).
 */
export async function extractMotion(page: Page): Promise<MotionAudit> {
  try {
    const { entries, truncated } = await page.evaluate((maxElements) => {
      function describeSelector(el: Element): string {
        const tag = el.tagName.toLowerCase();
        if (el.id) return `${tag}#${el.id}`;
        const classes = Array.from(el.classList).slice(0, 2);
        return classes.length > 0 ? `${tag}.${classes.join('.')}` : tag;
      }

      const out: RawMotionEntry[] = [];

      for (const anim of document.getAnimations()) {
        const effect = anim.effect;
        const target = effect && 'target' in effect ? (effect as KeyframeEffect).target : null;
        const selector = target instanceof Element ? describeSelector(target) : 'unknown';
        const timing = effect?.getTiming ? effect.getTiming() : {};
        const durationMs = typeof timing.duration === 'number' ? timing.duration : 0;
        const rawIterations = timing.iterations ?? 1;
        const iterations: number | 'infinite' =
          rawIterations === Infinity ? 'infinite' : rawIterations;

        if (typeof CSSTransition !== 'undefined' && anim instanceof CSSTransition) {
          out.push({
            selector,
            kind: 'transition',
            name: anim.transitionProperty,
            durationMs,
            iterations,
            properties: [anim.transitionProperty],
          });
        } else if (typeof CSSAnimation !== 'undefined' && anim instanceof CSSAnimation) {
          out.push({
            selector,
            kind: 'animation',
            name: anim.animationName,
            durationMs,
            iterations,
            properties: [],
          });
        } else {
          out.push({
            selector,
            kind: 'animation',
            name: anim.id || 'unknown',
            durationMs,
            iterations,
            properties: [],
          });
        }
      }

      const elements = document.querySelectorAll('*');
      const truncated = elements.length > maxElements;
      const seen = new Set<string>();
      let scanned = 0;
      for (const el of elements) {
        if (scanned >= maxElements) break;
        scanned++;
        const style = getComputedStyle(el);
        const durations = style.transitionDuration.split(',').map((d) => d.trim());
        const properties = style.transitionProperty.split(',').map((p) => p.trim());
        const hasRealDuration = durations.some((d) => d !== '0s' && d !== '0ms');
        const realProps = properties.filter((p) => p !== 'all' && p !== 'none');
        if (hasRealDuration && realProps.length > 0) {
          const selector = describeSelector(el);
          const name = realProps.join(',');
          const key = `${selector}|${name}`;
          if (!seen.has(key)) {
            seen.add(key);
            const maxDurationMs = Math.max(
              ...durations.map((d) => (d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000)),
            );
            out.push({
              selector,
              kind: 'transition',
              name,
              durationMs: maxDurationMs,
              iterations: 1,
              properties: realProps,
            });
          }
        }
      }

      return { entries: out, truncated };
    }, MAX_ELEMENTS_SCANNED);

    let reducedMotionRespected: boolean | null = null;
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const stillRunning = await page.evaluate((thresholdMs) => {
        let count = 0;
        for (const anim of document.getAnimations()) {
          const timing = anim.effect?.getTiming ? anim.effect.getTiming() : {};
          const durationMs = typeof timing.duration === 'number' ? timing.duration : 0;
          const iterations = timing.iterations ?? 1;
          if (durationMs > thresholdMs && iterations !== 0) count++;
        }
        return count;
      }, REDUCED_MOTION_DURATION_THRESHOLD_MS);
      reducedMotionRespected = stillRunning === 0;
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }

    return buildMotionAudit(entries, reducedMotionRespected, truncated);
  } catch {
    return buildMotionAudit([], null);
  }
}

export function formatMotionAudit(audit: MotionAudit, opts: { compact?: boolean } = {}): string {
  const animCount = audit.entries.filter((e) => e.kind === 'animation').length;
  const transitionCount = audit.entries.filter((e) => e.kind === 'transition').length;
  const infiniteNote = audit.infinite.length > 0 ? ` (${audit.infinite.length} infinite ⚠)` : '';
  const reducedMotionNote =
    audit.reducedMotionRespected === null
      ? 'not probed'
      : audit.reducedMotionRespected
        ? 'respected'
        : 'IGNORED';

  if (opts.compact) {
    const bits = [
      `${animCount} animation${animCount === 1 ? '' : 's'}${infiniteNote}`,
      `${transitionCount} transition${transitionCount === 1 ? '' : 's'}`,
    ];
    if (audit.layoutRisk.length > 0) bits.push(`${audit.layoutRisk.length} layout-risk ⚠`);
    if (audit.long.length > 0) bits.push(`${audit.long.length} long`);
    bits.push(`reduced-motion ${reducedMotionNote}`);
    return `## Motion: ${bits.join(', ')}${audit.truncated ? ' (scan truncated at 1500 elements)' : ''}\n`;
  }

  const lines = ['## Motion\n'];
  lines.push(
    `${animCount} animation${animCount === 1 ? '' : 's'} running${infiniteNote} · transitions declared on ${transitionCount} element${transitionCount === 1 ? '' : 's'}`,
  );
  if (audit.layoutRisk.length > 0) {
    lines.push(`⚠ layout-property transitions (jank risk): ${audit.layoutRisk.length}`);
    for (const e of audit.layoutRisk) {
      lines.push(`  ${e.selector} → ${e.name} (${e.durationMs}ms)`);
    }
  }
  if (audit.long.length > 0) {
    const detail = audit.long.map((e) => `${e.selector} ${e.name} ${e.durationMs}ms`).join(', ');
    lines.push(`long (>1000ms): ${audit.long.length} — ${detail}`);
  }
  lines.push(`reduced-motion: ${reducedMotionNote}`);
  if (audit.truncated) lines.push('(scan truncated at 1500 elements)');
  lines.push('');
  return lines.join('\n');
}
