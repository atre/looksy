import { readFileSync } from 'node:fs';
import { luminance, contrastRatio } from './contrast.js';

export interface ThemePair {
  fg: string;
  bg: string;
  label?: string;
}

export interface ThemeValidationResult {
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  aaPass: boolean;
  aaaPass: boolean;
  /** Within 0.05 of the 4.5 (AA) or 7 (AAA) threshold — flagged so 4.499 doesn't read as "4.50 FAIL". */
  borderline?: boolean;
}

/** Ratio text: 2 decimals normally, 3 when rounding would hide which side of a threshold it sits on. */
export function formatRatio(ratio: number): string {
  const nearAa = Math.abs(ratio - 4.5) < 0.05;
  const nearAaa = Math.abs(ratio - 7) < 0.05;
  return nearAa || nearAaa ? ratio.toFixed(3) : ratio.toFixed(2);
}

/**
 * Parse a hex color (#rgb, #rrggbb) or rgb(r,g,b) to [r, g, b].
 */
export function parseColor(color: string): [number, number, number] | null {
  const hex = color.trim();
  // #rrggbb or #rrggbbaa
  if (/^#[0-9a-fA-F]{6,8}$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  // #rgb
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ];
  }
  // rgb(r, g, b)
  const match = hex.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }
  // hsl(h, s%, l%) or hsla(h, s%, l%, a)
  const hslMatch = hex.match(/hsla?\(\s*([\d.]+),?\s*([\d.]+)%,?\s*([\d.]+)%/);
  if (hslMatch) {
    return hslToRgb(
      parseFloat(hslMatch[1]),
      parseFloat(hslMatch[2]) / 100,
      parseFloat(hslMatch[3]) / 100,
    );
  }
  // Bare HSL values (shadcn/ui): "222.2 84% 4.9%"
  const bareHsl = hex.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (bareHsl) {
    return hslToRgb(
      parseFloat(bareHsl[1]),
      parseFloat(bareHsl[2]) / 100,
      parseFloat(bareHsl[3]) / 100,
    );
  }
  return null;
}

/**
 * Convert HSL to RGB. h in degrees, s and l in [0, 1].
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Extract color custom properties from :root / @theme blocks. Names are stripped of `color-`. */
export function extractCssColors(raw: string): Record<string, string> {
  const colors: Record<string, string> = {};

  // Extract all :root { ... } and Tailwind v4 @theme { ... } blocks (handle multiple).
  // @theme vars are namespaced (`--color-primary`); the `color-` prefix is stripped so the
  // shadcn-style `X` / `X-foreground` pairing below works on both conventions.
  const rootRegex = /(?::root|@theme(?:\s+[\w-]+)?)\s*\{([^}]+)\}/g;
  let rootMatch;
  while ((rootMatch = rootRegex.exec(raw)) !== null) {
    const block = rootMatch[1];
    const varRegex = /--([\w-]+)\s*:\s*([^;]+)/g;
    let varMatch;
    while ((varMatch = varRegex.exec(block)) !== null) {
      const name = varMatch[1].trim().replace(/^color-/, '');
      const value = varMatch[2].trim();
      // Only keep values that look like colors
      if (parseColor(value)) {
        colors[name] = value;
      }
    }
  }

  return colors;
}

export interface CssPairingOptions {
  /** Explicit foreground tokens (`--text-on foreground,muted-foreground`) crossed with bg tokens. */
  textOn?: string[];
  /** Background tokens to cross with textOn (default: every other color token). */
  bgTokens?: string[];
}

/** Normalize a user-supplied token: strip leading `--` and `color-`. */
const normToken = (t: string): string =>
  t
    .trim()
    .replace(/^--/, '')
    .replace(/^color-/, '');

/**
 * Cross-product pairing: each --text-on token as fg over each bg token. Skips fg==bg. This is
 * the "I have 3 text colors and 12 surfaces, check all of them" case that used to require a
 * hand-built JSON pairs file.
 */
export function crossPairCssColors(
  colors: Record<string, string>,
  opts: CssPairingOptions,
): ThemePair[] {
  const fgs = (opts.textOn ?? []).map(normToken).filter(Boolean);
  if (fgs.length === 0) throw new Error('--text-on requires at least one token');
  const missing = fgs.filter((f) => !colors[f]);
  if (missing.length > 0) {
    throw new Error(
      `--text-on token(s) not found in CSS: ${missing.map((m) => `--${m}`).join(', ')}. Available: ${Object.keys(
        colors,
      )
        .map((k) => `--${k}`)
        .join(', ')}`,
    );
  }
  const bgs =
    opts.bgTokens && opts.bgTokens.length > 0
      ? opts.bgTokens.map(normToken).filter(Boolean)
      : Object.keys(colors);
  const missingBg = bgs.filter((b) => !colors[b]);
  if (missingBg.length > 0) {
    throw new Error(
      `--bg-tokens token(s) not found in CSS: ${missingBg.map((m) => `--${m}`).join(', ')}`,
    );
  }
  const pairs: ThemePair[] = [];
  for (const fg of fgs) {
    for (const bg of bgs) {
      if (fg === bg) continue;
      const fgHex = resolveToHex(colors[fg]);
      const bgHex = resolveToHex(colors[bg]);
      if (fgHex && bgHex) pairs.push({ fg: fgHex, bg: bgHex, label: `--${fg} on --${bg}` });
    }
  }
  if (pairs.length === 0)
    throw new Error('--text-on produced no pairs (fg == bg or unparseable colors)');
  return pairs;
}

/**
 * Parse CSS file for :root / @theme custom properties and generate contrast pairs —
 * by naming convention (default) or as a --text-on cross-product.
 * Supports hex, rgb(), hsl(), and bare HSL (shadcn/ui) values.
 */
export function loadThemeFromCss(cssPath: string, opts: CssPairingOptions = {}): ThemePair[] {
  const raw = readFileSync(cssPath, 'utf-8');
  const colors = extractCssColors(raw);

  if (Object.keys(colors).length === 0) {
    throw new Error('No color CSS custom properties found in :root or @theme');
  }

  if (opts.textOn && opts.textOn.length > 0) return crossPairCssColors(colors, opts);
  return autoPairCssColors(colors);
}

/**
 * Auto-generate fg/bg pairs from CSS variable names using common naming conventions.
 */
export function autoPairCssColors(colors: Record<string, string>): ThemePair[] {
  const pairs: ThemePair[] = [];
  const names = Object.keys(colors);
  const used = new Set<string>();

  // Pattern 1: --X-foreground on --X (shadcn/ui convention)
  for (const name of names) {
    if (name.endsWith('-foreground')) {
      const base = name.replace(/-foreground$/, '');
      if (colors[base]) {
        const fgHex = resolveToHex(colors[name]);
        const bgHex = resolveToHex(colors[base]);
        if (fgHex && bgHex) {
          pairs.push({ fg: fgHex, bg: bgHex, label: `--${base}` });
          used.add(name);
          used.add(base);
        }
      }
    }
  }

  // Pattern 2: --foreground on --background
  if (colors['foreground'] && colors['background'] && !used.has('foreground')) {
    const fgHex = resolveToHex(colors['foreground']);
    const bgHex = resolveToHex(colors['background']);
    if (fgHex && bgHex) {
      pairs.push({ fg: fgHex, bg: bgHex, label: 'foreground on background' });
      used.add('foreground');
      used.add('background');
    }
  }

  // Pattern 3: --X-fg on --X-bg or --X-text on --X-bg
  for (const name of names) {
    if (used.has(name)) continue;
    const fgSuffixes = ['-fg', '-text', '-color'];
    const bgSuffixes = ['-bg', '-surface'];
    for (const fgSuf of fgSuffixes) {
      if (name.endsWith(fgSuf)) {
        const base = name.replace(new RegExp(`${fgSuf}$`), '');
        for (const bgSuf of bgSuffixes) {
          const bgName = `${base}${bgSuf}`;
          if (colors[bgName]) {
            const fgHex = resolveToHex(colors[name]);
            const bgHex = resolveToHex(colors[bgName]);
            if (fgHex && bgHex) {
              pairs.push({ fg: fgHex, bg: bgHex, label: `--${base}` });
              used.add(name);
              used.add(bgName);
            }
          }
        }
      }
    }
  }

  // If no pairs found via conventions, pair remaining fg-like vars against bg-like vars
  if (pairs.length === 0) {
    const fgVars = names.filter(
      (n) =>
        n.includes('text') || n.includes('foreground') || n.includes('fg') || n.includes('color'),
    );
    const bgVars = names.filter(
      (n) => n.includes('background') || n.includes('bg') || n.includes('surface'),
    );
    for (const fg of fgVars) {
      for (const bg of bgVars) {
        const fgHex = resolveToHex(colors[fg]);
        const bgHex = resolveToHex(colors[bg]);
        if (fgHex && bgHex) {
          pairs.push({ fg: fgHex, bg: bgHex, label: `--${fg} on --${bg}` });
        }
      }
    }
  }

  if (pairs.length === 0) {
    throw new Error(
      'Could not auto-detect fg/bg color pairs from CSS variables. Use JSON format with explicit "pairs" array — e.g. {"pairs":[{"fg":"#fff","bg":"#333"}]}',
    );
  }

  return pairs;
}

function resolveToHex(value: string): string | null {
  const rgb = parseColor(value);
  if (!rgb) return null;
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Load a theme config file and return normalized pairs.
 *
 * Supports three formats:
 * 1. CSS file (.css): parse :root custom properties, auto-pair by naming convention
 * 2. Simple JSON: { "pairs": [{ "fg": "#fff", "bg": "#000", "label": "..." }] }
 * 3. Token JSON:  { "colors": { "primary": "#1a1a2e", ... }, "pairs": [{ "fg": "primary", "bg": "bg", "label": "..." }] }
 */
export function loadThemeConfig(configPath: string, opts: CssPairingOptions = {}): ThemePair[] {
  if (configPath.endsWith('.css')) {
    return loadThemeFromCss(configPath, opts);
  }
  if (opts.textOn && opts.textOn.length > 0) {
    throw new Error(
      '--text-on only applies to CSS input (token cross-product); JSON configs list pairs explicitly',
    );
  }

  const raw = readFileSync(configPath, 'utf-8');
  const data = JSON.parse(raw);

  if (!data.pairs || !Array.isArray(data.pairs)) {
    throw new Error(
      'Theme config must have a "pairs" array — e.g. {"pairs":[{"fg":"#fff","bg":"#333"}]}',
    );
  }

  const colors: Record<string, string> = data.colors || {};

  return data.pairs.map((p: any, i: number) => {
    let fg = String(p.fg || '');
    let bg = String(p.bg || '');

    // Resolve token names
    if (fg && !fg.startsWith('#') && !fg.startsWith('rgb')) {
      if (colors[fg]) fg = colors[fg];
      else
        throw new Error(
          `Unknown color token "${fg}" in pair ${i + 1}. Add it to "colors" map — e.g. {"colors":{"primary":"#1a1a2e"},"pairs":[{"fg":"primary","bg":"bg"}]}`,
        );
    }
    if (bg && !bg.startsWith('#') && !bg.startsWith('rgb')) {
      if (colors[bg]) bg = colors[bg];
      else
        throw new Error(
          `Unknown color token "${bg}" in pair ${i + 1}. Add it to "colors" map — e.g. {"colors":{"primary":"#1a1a2e"},"pairs":[{"fg":"primary","bg":"bg"}]}`,
        );
    }

    // `label` is canonical; `name` is accepted too — it was silently dropped before, which
    // left the table showing "Pair N" and forced row-counting to map failures back.
    return { fg, bg, label: p.label || p.name || `Pair ${i + 1}` };
  });
}

/**
 * Validate color pairs against WCAG contrast thresholds.
 * AA normal text: 4.5:1, AAA normal text: 7:1.
 */
export function validateTheme(pairs: ThemePair[]): ThemeValidationResult[] {
  return pairs.map((p) => {
    const fgRgb = parseColor(p.fg);
    const bgRgb = parseColor(p.bg);

    if (!fgRgb || !bgRgb) {
      return {
        label: p.label || 'unknown',
        fg: p.fg,
        bg: p.bg,
        ratio: 0,
        aaPass: false,
        aaaPass: false,
      };
    }

    const fgLum = luminance(...fgRgb);
    const bgLum = luminance(...bgRgb);
    const ratio = contrastRatio(fgLum, bgLum);

    return {
      label: p.label || 'unknown',
      fg: p.fg,
      bg: p.bg,
      ratio,
      aaPass: ratio >= 4.5,
      aaaPass: ratio >= 7,
      borderline: Math.abs(ratio - 4.5) < 0.05 || Math.abs(ratio - 7) < 0.05,
    };
  });
}

export function formatThemeResults(
  results: ThemeValidationResult[],
  opts: { compact?: boolean } = {},
): string {
  const aaFails = results.filter((r) => !r.aaPass);

  if (opts.compact) {
    const status =
      aaFails.length === 0 ? 'all pass AA' : `${aaFails.length}/${results.length} fail AA`;
    const details =
      aaFails.length > 0
        ? ': ' +
          aaFails
            .map(
              (r) => `${r.label} ${formatRatio(r.ratio)}:1${r.borderline ? ' (borderline)' : ''}`,
            )
            .join(', ')
        : '';
    return `Theme validation: ${status}${details}\n`;
  }

  const lines = ['## Theme Validation\n'];
  lines.push(`| Label | FG | BG | Ratio | AA | AAA |`);
  lines.push('|-------|----|----|-------|----|-----|');

  for (const r of results) {
    const aa = r.aaPass ? 'Pass' : '**FAIL**';
    const aaa = r.aaaPass ? 'Pass' : 'Fail';
    const note = r.borderline ? ' (borderline)' : '';
    lines.push(
      `| ${r.label} | \`${r.fg}\` | \`${r.bg}\` | ${formatRatio(r.ratio)}:1${note} | ${aa} | ${aaa} |`,
    );
  }
  lines.push('');

  if (aaFails.length > 0) {
    lines.push(`### AA Failures (${aaFails.length})\n`);
    for (const r of aaFails) {
      lines.push(
        `- **${r.label}**: \`${r.fg}\` on \`${r.bg}\` = ${formatRatio(r.ratio)}:1 (need 4.5:1)${r.borderline ? ' — borderline, a 1-step tweak clears it' : ''}`,
      );
    }
    lines.push('');
  }

  const total = results.length;
  const summary =
    aaFails.length === 0
      ? `All ${total} pairs pass WCAG AA.`
      : `${aaFails.length}/${total} pairs fail WCAG AA.`;
  lines.push(summary);
  lines.push('');

  return lines.join('\n');
}

/**
 * Top-level entry point: load config, validate, format.
 */
export function runThemeValidation(
  configPath: string,
  opts: { compact?: boolean } & CssPairingOptions = {},
): {
  results: ThemeValidationResult[];
  aaFailures: number;
  aaaFailures: number;
  text: string;
} {
  const pairs = loadThemeConfig(configPath, { textOn: opts.textOn, bgTokens: opts.bgTokens });
  const results = validateTheme(pairs);
  const aaFailures = results.filter((r) => !r.aaPass).length;
  const aaaFailures = results.filter((r) => !r.aaaPass).length;
  const text = formatThemeResults(results, opts);
  return { results, aaFailures, aaaFailures, text };
}
