import type { Page } from 'playwright';

function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

interface ContrastPair {
  tag: string;
  text: string;
  className: string;
  color: string;
  bg: string;
  fontSize: string;
  fontWeight: string;
  source?: string;
}

export interface ContrastPairResult {
  tag: string;
  text: string;
  className: string;
  color: string;
  bg: string;
  ratio: number;
  aaPass: boolean;
  aaaPass: boolean;
  /** Optional file:line hint resolved from React fiber `_debugSource` if available. */
  source?: string;
}

export interface ContrastResult {
  text: string;
  aaFailures: number;
  aaaFailures: number;
  /** Count of pairs with ratio < INVISIBLE_RATIO_THRESHOLD — a strict subset of aaFailures. */
  invisibleFailures: number;
  pairs: ContrastPairResult[];
  /** Number of elements actually scored (= pairs.length). */
  sampled: number;
  /** Total eligible text-bearing elements found (may exceed sampled when capped). */
  total: number;
  /** True when the sample hit the limit and eligible candidates went unchecked. */
  capped: boolean;
}

/**
 * Extract text/background color pairs and compute WCAG contrast ratios.
 * Walks up the DOM to resolve transparent backgrounds.
 */
export const DEFAULT_CONTRAST_LIMIT = 150;

/** WCAG contrast ratios below this are effectively unreadable, not just AA-failing. */
export const INVISIBLE_RATIO_THRESHOLD = 1.5;

export async function extractContrast(
  page: Page,
  opts: { compact?: boolean; visibleOnly?: boolean; limit?: number } = {},
): Promise<ContrastResult> {
  const visibleOnly = opts.visibleOnly ?? false;
  const limit = opts.limit ?? DEFAULT_CONTRAST_LIMIT;
  const scan = await page.evaluate(
    (args: { filterVisible: boolean; limit: number }) => {
      const { filterVisible, limit } = args;
      const results: ContrastPair[] = [];
      const selectors = 'h1,h2,h3,h4,h5,h6,p,a,button,span,li,td,th,label,div';
      let capped = false;
      let eligible = 0;

      for (const el of document.querySelectorAll(selectors)) {
        const text = (el.textContent || '').trim().slice(0, 40);
        if (!text || text.length < 2) continue;

        // Attribute contrast to leaf text nodes only. Skip elements whose visible text
        // lives entirely in child elements (cards, wrapping <a>/<li>/<div>): their children
        // are sampled individually, so scoring the container both double-counts and yields a
        // bogus ratio (its own color vs an inherited bg it never actually renders text on).
        let hasOwnText = false;
        for (const node of el.childNodes) {
          if (node.nodeType === 3 && (node.textContent || '').trim().length >= 2) {
            hasOwnText = true;
            break;
          }
        }
        if (!hasOwnText) continue;

        // Skip hidden elements when --visible-only (inline check to avoid named function
        // inside evaluate — esbuild keepNames wraps them with __name() breaking browser context)
        if (filterVisible) {
          let hidden = false;
          let cur: Element | null = el;
          while (cur) {
            const cs = getComputedStyle(cur);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
              hidden = true;
              break;
            }
            const rect = cur.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
              hidden = true;
              break;
            }
            cur = cur.parentElement;
          }
          if (hidden) continue;
        }

        // Eligible sample candidate. Count every candidate — even past the limit — so coverage
        // (sampled/total) can be reported and partial coverage isn't mistaken for a clean pass.
        eligible++;
        if (results.length >= limit) {
          capped = true;
          continue;
        }

        const style = getComputedStyle(el);

        // Walk up to find non-transparent background
        let bg = 'rgb(255, 255, 255)';
        let current: Element | null = el;
        while (current) {
          const cs = getComputedStyle(current);
          const bgColor = cs.backgroundColor;
          if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            bg = bgColor;
            break;
          }
          current = current.parentElement;
        }

        // Best-effort React fiber → file:line resolution (dev builds only)
        let source: string | undefined;
        let probe: any = el;
        while (probe && !source) {
          const fiberKey = Object.keys(probe).find(
            (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
          );
          if (fiberKey) {
            let fiber = probe[fiberKey];
            while (fiber && !source) {
              const dbg = fiber._debugSource;
              if (dbg && dbg.fileName) {
                const file = String(dbg.fileName).split('/').slice(-2).join('/');
                source = dbg.lineNumber ? `${file}:${dbg.lineNumber}` : file;
                break;
              }
              fiber = fiber._debugOwner || fiber.return;
            }
          }
          probe = probe.parentElement;
        }

        results.push({
          tag: el.tagName.toLowerCase(),
          text,
          className: (el.getAttribute('class') || '').trim().slice(0, 100),
          color: style.color,
          bg,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          source,
        });
      }

      return { results, capped, eligible };
    },
    { filterVisible: visibleOnly, limit },
  );

  const pairs = scan.results;
  const total = scan.eligible;
  const compact = opts.compact ?? false;

  // First pass: compute all ratios
  const results: ContrastPairResult[] = [];
  for (const p of pairs) {
    const fg = parseRgb(p.color);
    const bg = parseRgb(p.bg);
    if (!fg || !bg) continue;

    // Un-renderable pair: computed text color equals its resolved background. The element
    // renders no visible text in that color (inheriting wrapper, icon font, ::before), so the
    // 1.0:1 ratio is noise — skip rather than report a phantom failure.
    if (fg[0] === bg[0] && fg[1] === bg[1] && fg[2] === bg[2]) continue;

    const l1 = luminance(...fg);
    const l2 = luminance(...bg);
    const ratio = contrastRatio(l1, l2);

    const fontSize = parseFloat(p.fontSize);
    const isBold = parseInt(p.fontWeight) >= 700;
    const isLarge = fontSize >= 18 || (fontSize >= 14 && isBold);

    const aaThreshold = isLarge ? 3 : 4.5;
    const aaaThreshold = isLarge ? 4.5 : 7;

    results.push({
      tag: p.tag,
      text: p.text.length > 20 ? p.text.slice(0, 20) + '...' : p.text,
      className: p.className,
      color: p.color,
      bg: p.bg,
      ratio,
      aaPass: ratio >= aaThreshold,
      aaaPass: ratio >= aaaThreshold,
      source: p.source,
    });
  }

  const aaFailures = results.filter((r) => !r.aaPass).length;
  const aaaFailures = results.filter((r) => !r.aaaPass).length;
  // Invisible severity: ratio < INVISIBLE_RATIO_THRESHOLD is a strict subset of AA failures
  // (1.5 is below both the 3:1 and 4.5:1 AA thresholds) — a more-severe re-labeling of some
  // AA fails, not an additional count layered on top of aaFailures.
  const invisibleFailures = results.filter((r) => r.ratio < INVISIBLE_RATIO_THRESHOLD).length;

  // Coverage: when the sample was capped, surface how many eligible elements went unchecked
  // so "All N pass" can't be mistaken for a full clean bill (the default 150 cap is often
  // smaller than a real DOM's text-element count).
  const sampled = results.length;
  const capped = scan.capped;
  const unchecked = capped ? Math.max(0, total - sampled) : 0;
  const capNote =
    unchecked > 0
      ? ` _(sampled ${sampled}/${total}; ${unchecked} unchecked — raise with --contrast-limit)_`
      : '';
  const base = {
    aaFailures,
    aaaFailures,
    invisibleFailures,
    pairs: results,
    sampled,
    total,
    capped,
  };

  return { text: formatContrastText(results, { compact, capNote }), ...base };
}

/**
 * Pure text renderer for contrast results — no DOM/browser dependency, so it's directly
 * unit-testable (see tests/unit/contrast.test.ts). Handles both compact
 * (`--check`/`--brief`/`--design-audit`) and full (`--contrast`) markdown output.
 *
 * Invisible pairs (ratio < INVISIBLE_RATIO_THRESHOLD) are a strict subset of AA failures.
 * They're partitioned out and rendered first/standalone, tagged `[INVISIBLE]`, and excluded
 * from semantic grouping — a distinct severity tier, not a pattern to dedupe alongside others.
 */
export function formatContrastText(
  results: ContrastPairResult[],
  opts: { compact?: boolean; capNote?: string } = {},
): string {
  const compact = opts.compact ?? false;
  const capNote = opts.capNote ?? '';
  const aaFailures = results.filter((r) => !r.aaPass).length;

  const invisible = results.filter((r) => r.ratio < INVISIBLE_RATIO_THRESHOLD);
  const invisibleSet = new Set(invisible);
  const ordinaryAaFails = results.filter((r) => !r.aaPass && !invisibleSet.has(r));

  // Semantic grouping: group the non-invisible failures by CSS class or color pair
  const failureGroups = groupFailures(ordinaryAaFails);

  // Compact mode: skip if all pass, otherwise only show failures
  if (compact) {
    if (aaFailures === 0) {
      return `## Contrast: All ${results.length} pass AA${capNote}\n`;
    }
    const lines: string[] = [
      `## Contrast: ${aaFailures}/${results.length} AA failure(s)${capNote}`,
    ];
    for (const r of invisible) {
      const cls = r.className
        ? ` [${r.className.length > 60 ? r.className.slice(0, 60) + '...' : r.className}]`
        : '';
      const src = r.source ? ` @ ${r.source}` : '';
      lines.push(
        `- [INVISIBLE] ${r.tag} "${r.text}" — ${r.ratio.toFixed(1)}:1 (${r.color} on ${r.bg})${cls}${src}`,
      );
    }
    if (failureGroups.length > 0) {
      for (const g of failureGroups) {
        lines.push(
          `- "${g.label}" (${g.count} element${g.count > 1 ? 's' : ''}): avg ${g.avgRatio.toFixed(1)}:1`,
        );
      }
    } else {
      for (const r of ordinaryAaFails) {
        const cls = r.className
          ? ` [${r.className.length > 60 ? r.className.slice(0, 60) + '...' : r.className}]`
          : '';
        const src = r.source ? ` @ ${r.source}` : '';
        lines.push(
          `- ${r.tag} "${r.text}" — ${r.ratio.toFixed(1)}:1 (${r.color} on ${r.bg})${cls}${src}`,
        );
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  // Full mode
  const lines: string[] = ['## Color Contrast (WCAG)\n'];
  const anySource = results.some((r) => r.source);
  if (anySource) {
    lines.push('| Element | Class | Text | FG | BG | Ratio | AA | AAA | Source |');
    lines.push('|---------|-------|------|----|----|-------|----|-----|--------|');
  } else {
    lines.push('| Element | Class | Text | FG | BG | Ratio | AA | AAA |');
    lines.push('|---------|-------|------|----|----|-------|----|-----|');
  }

  // Invisible rows render first (tagged), ahead of the rest in their original order.
  const orderedRows = [...invisible, ...results.filter((r) => !invisibleSet.has(r))];
  for (const r of orderedRows) {
    const cls = r.className ? r.className.split(/\s+/).slice(0, 3).join(' ') : '';
    const sourceCol = anySource ? ` ${r.source ? `\`${r.source}\`` : ''} |` : '';
    const elCol = invisibleSet.has(r) ? `[INVISIBLE] \`${r.tag}\`` : `\`${r.tag}\``;
    lines.push(
      `| ${elCol} | ${cls ? `\`${cls}\`` : ''} | ${r.text} | \`${r.color}\` | \`${r.bg}\` | ${r.ratio.toFixed(1)}:1 | ${r.aaPass ? 'Pass' : '**FAIL**'} | ${r.aaaPass ? 'Pass' : '**FAIL**'} |${sourceCol}`,
    );
  }

  lines.push('');
  if (aaFailures > 0) {
    if (invisible.length > 0) {
      lines.push(
        `**${invisible.length} invisible (< ${INVISIBLE_RATIO_THRESHOLD}:1)** — critically unreadable, counted separately from the AA failures below.\n`,
      );
    }
    lines.push(
      `**${aaFailures} AA contrast failure(s)** — text may be unreadable for some users.\n`,
    );
    if (failureGroups.length > 0) {
      lines.push('### Failure patterns\n');
      for (const g of failureGroups) {
        const elements = g.items.map((i) => `\`${i.tag}\` "${i.text}"`).join(', ');
        lines.push(`- **"${g.label}"** (${g.count}): avg ${g.avgRatio.toFixed(1)}:1 — ${elements}`);
      }
      lines.push('');
    }

    // Suggest fixes for AA failures
    const fixLines: string[] = [];
    const seenFixes = new Set<string>();
    for (const r of results.filter((r) => !r.aaPass)) {
      const fg = parseRgb(r.color);
      const bg = parseRgb(r.bg);
      if (!fg || !bg) continue;
      const fixKey = `${r.color}|${r.bg}`;
      if (seenFixes.has(fixKey)) continue;
      seenFixes.add(fixKey);
      const fix = suggestContrastFix(fg, bg, 4.5);
      if (fix) {
        const side = fix.type === 'bg' ? 'bg' : 'fg';
        const desc = `${fix.direction} ${side} to \`${fix.hex}\``;
        fixLines.push(`- \`${r.color}\` on \`${r.bg}\` → ${desc} for ${fix.ratio.toFixed(1)}:1`);
      }
    }
    if (fixLines.length > 0) {
      lines.push('### Suggested fixes\n');
      lines.push(...fixLines);
      lines.push('');
    }
  } else {
    lines.push(
      `All ${results.length} sampled text elements pass WCAG AA contrast requirements.${capNote}\n`,
    );
  }

  return lines.join('\n');
}

type RGB = [number, number, number];

const toHex = (n: RGB): string =>
  '#' +
  n
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

const rgbDist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Suggest a concrete fix color that meets a target contrast ratio.
 *
 * Scans both the foreground and the background, in both directions (toward black and toward
 * white), and returns the single-side adjustment with the smallest perceptual change that
 * reaches the target — e.g. "lighten fg to #8a8a8a for 4.5:1". Trying both directions (the
 * original only darkened) means a concrete color is almost always available, so callers rarely
 * fall back to generic "use higher contrast" advice. Returns null only when no single-side
 * tweak can reach the target (both colors mid-range); the caller should then change both.
 */
export function suggestContrastFix(
  fgRgb: RGB,
  bgRgb: RGB,
  targetRatio: number,
): { type: 'bg' | 'fg'; direction: 'darken' | 'lighten'; hex: string; ratio: number } | null {
  const fgLum = luminance(...fgRgb);
  const bgLum = luminance(...bgRgb);

  const sides: Array<{ type: 'fg' | 'bg'; rgb: RGB; fixedLum: number }> = [
    { type: 'fg', rgb: fgRgb, fixedLum: bgLum },
    { type: 'bg', rgb: bgRgb, fixedLum: fgLum },
  ];
  const directions: Array<'darken' | 'lighten'> = ['darken', 'lighten'];

  let best: {
    type: 'bg' | 'fg';
    direction: 'darken' | 'lighten';
    hex: string;
    ratio: number;
    delta: number;
  } | null = null;
  for (const side of sides) {
    for (const direction of directions) {
      for (let t = 0.025; t <= 1.0001; t += 0.025) {
        const n: RGB =
          direction === 'darken'
            ? [side.rgb[0] * (1 - t), side.rgb[1] * (1 - t), side.rgb[2] * (1 - t)]
            : [
                side.rgb[0] + (255 - side.rgb[0]) * t,
                side.rgb[1] + (255 - side.rgb[1]) * t,
                side.rgb[2] + (255 - side.rgb[2]) * t,
              ];
        const ratio = contrastRatio(side.fixedLum, luminance(...n));
        if (ratio >= targetRatio) {
          const delta = rgbDist(side.rgb, n);
          if (!best || delta < best.delta) {
            best = { type: side.type, direction, hex: toHex(n), ratio, delta };
          }
          break; // first hit per side+direction is the minimal change for that combo
        }
      }
    }
  }
  if (!best) return null;
  return { type: best.type, direction: best.direction, hex: best.hex, ratio: best.ratio };
}

interface FailureGroup {
  label: string;
  count: number;
  avgRatio: number;
  items: ContrastPairResult[];
}

const avgRatio = (items: ContrastPairResult[]): number =>
  items.reduce((sum, i) => sum + i.ratio, 0) / items.length;

/** Group contrast failures by CSS class pattern or color pair for semantic analysis. */
function groupFailures(failures: ContrastPairResult[]): FailureGroup[] {
  if (failures.length < 2) return [];

  const classGroups = new Map<string, ContrastPairResult[]>();
  for (const f of failures) {
    if (!f.className) continue;
    for (const cls of f.className.split(/\s+/)) {
      if (!cls || cls.length < 2) continue;
      if (!classGroups.has(cls)) classGroups.set(cls, []);
      classGroups.get(cls)!.push(f);
    }
  }

  const groups: FailureGroup[] = [];
  const usedItems = new Set<ContrastPairResult>();

  const sortedClasses = [...classGroups.entries()]
    .filter(([, items]) => items.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [cls, items] of sortedClasses) {
    const uniqueItems = items.filter((i) => !usedItems.has(i));
    if (uniqueItems.length < 2) continue;
    for (const i of uniqueItems) usedItems.add(i);
    groups.push({
      label: cls,
      count: uniqueItems.length,
      avgRatio: avgRatio(uniqueItems),
      items: uniqueItems,
    });
  }

  const ungrouped = failures.filter((f) => !usedItems.has(f));
  if (ungrouped.length > 1) {
    const colorGroups = new Map<string, ContrastPairResult[]>();
    for (const f of ungrouped) {
      const key = `${f.color} on ${f.bg}`;
      if (!colorGroups.has(key)) colorGroups.set(key, []);
      colorGroups.get(key)!.push(f);
    }
    for (const [key, items] of colorGroups) {
      if (items.length < 2) continue;
      groups.push({ label: key, count: items.length, avgRatio: avgRatio(items), items });
    }
  }

  return groups;
}
