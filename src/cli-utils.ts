import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewports, descriptorViewport, type Viewport } from './viewports.js';
import { loadFleetConfig, expandFleetTargets } from './fleet-config.js';

/** Newest mtime (ms) among the paths that exist, or undefined when none does. */
export function newestMtimeMs(paths: string[]): number | undefined {
  let best: number | undefined;
  for (const p of paths) {
    try {
      const m = statSync(p).mtimeMs;
      if (best === undefined || m > best) best = m;
    } catch {
      /* missing */
    }
  }
  return best;
}

/** Validate that a CLI flag value is a finite integer. Exits with error if not. */
export function validateNumeric(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    console.error(`looksy: --${flag} requires an integer, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

/**
 * Merge --inject CSS with --ignore mask CSS. --ignore hides dynamic regions
 * (ads, timestamps, carousels) at capture time so save/diff/guard compare
 * stable pixels; visibility:hidden keeps layout so masking never reflows.
 */
export function combineInject(
  inject: string | undefined,
  ignore: string | undefined,
): string | undefined {
  const selectors = (ignore ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const mask = selectors.length
    ? `${selectors.join(', ')} { visibility: hidden !important; }`
    : undefined;
  if (inject && mask) return `${inject}\n${mask}`;
  return mask ?? inject;
}

/** Validate that a CLI flag value is a finite number ≥ 0 (decimals allowed). Exits with error if not. */
export function validateFloat(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`looksy: --${flag} requires a non-negative number, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

/** --both errors when paired with --dark — one theme signal, not two. */
export function assertNotBothAndDark(both: boolean, dark: boolean): void {
  if (both && dark) {
    throw new Error('--both already captures both themes — drop --dark');
  }
}

/** --crop "x,y,w,h" → an exact-pixel Playwright clip region. */
export function parseCrop(raw: string): { x: number; y: number; width: number; height: number } {
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`--crop must be "x,y,w,h" of non-negative integers, got "${raw}"`);
  }
  const [x, y, width, height] = parts.map(Number);
  if (width <= 0 || height <= 0) {
    throw new Error(`--crop width/height must be > 0, got "${raw}"`);
  }
  return { x, y, width, height };
}

/** Same ratio math --micro uses (640px fixed) but parameterized by target width. */
export function thumbDimensions(
  width: number,
  height: number,
  thumbWidth: number,
): { width: number; height: number } {
  const ratio = thumbWidth / width;
  return { width: thumbWidth, height: Math.round(height * ratio) };
}

export function resolveUrl(input: string): string {
  if (/\s/.test(input.trim())) {
    throw new Error(
      `URL contains whitespace: "${input}" — did you mean separate args? (zsh: quote or use an array)`,
    );
  }
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('file://')) {
    return input;
  }
  if (input.startsWith('localhost') || input.startsWith(':')) {
    const addr = input.startsWith(':') ? `localhost${input}` : input;
    return `http://${addr}`;
  }
  if (input.startsWith('/') || input.startsWith('./') || input.startsWith('../')) {
    const abs = resolve(input);
    if (existsSync(abs)) {
      return pathToFileURL(abs).href;
    }
  }
  return `https://${input}`;
}

/**
 * Classify `-o` as a directory target (trailing slash, or an existing directory) or a
 * plain file path. Used by batch commands (fleet / --urls / --pages) to switch from
 * "last-URL-wins single file" to "one slug per URL" when `-o` names a directory.
 */
export function resolveOutputTarget(output: string | undefined): { dir?: string; file?: string } {
  if (!output) return {};
  if (output.endsWith('/')) return { dir: output.replace(/\/+$/, '') || '/' };
  if (existsSync(output) && statSync(output).isDirectory()) return { dir: output };
  return { file: output };
}

/** Slug a URL for --urls/fleet batch output: https://a.com/de/ → a-com-de; http://localhost:4321/de/ → localhost-4321-de */
export function urlToOutputSuffix(pageUrl: string): string {
  const parsed = new URL(pageUrl);
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const hostPart = LOOPBACK.has(parsed.hostname)
    ? `${parsed.hostname.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-${port}`
    : parsed.hostname.replace(/\./g, '-');
  const pathPart =
    parsed.pathname === '/'
      ? ''
      : parsed.pathname.replace(/^\//, '').replace(/\/+$/, '').replace(/\//g, '-');
  const pageSuffix = pathPart ? `${hostPart}-${pathPart}` : hostPart;
  return pageSuffix.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

/** Apply a suffix to a default output path: preview.png → preview-{suffix}.png */
export function applySuffix(path: string, suffix: string | undefined): string {
  if (!suffix) return path;
  const safe = suffix.replace(/[^a-zA-Z0-9_-]/g, '-');
  return path.replace(/(\.(png|jpg|jpeg|pdf|webm))$/, `-${safe}$1`);
}

/** Resolve --dismiss-consent / --consent-selector into a single mode: selector implies dismiss. */
export function resolveConsentMode(values: Record<string, any>): {
  dismiss: boolean;
  selector: string | undefined;
} {
  const selector = values['consent-selector'] ? String(values['consent-selector']) : undefined;
  return { dismiss: Boolean(values['dismiss-consent']) || selector !== undefined, selector };
}

/** fleet --design-audit defaults --fail-only on (audit runs are read for reds); --no-fail-only opts out. */
export function applyFleetDefaults(values: Record<string, any>): void {
  if (values['design-audit'] && !values['no-fail-only']) values['fail-only'] = true;
}

/** `diff` subcommand output paths: -o names the capture, diff image gets a -diff suffix beside it. */
export function diffOutputPaths(
  output: string | undefined,
  baseDir: string,
): { capture: string; diff: string } {
  if (!output) return { capture: `${baseDir}/preview.png`, diff: `${baseDir}/diff.png` };
  return { capture: output, diff: applySuffix(output, 'diff') };
}

/**
 * Parse `--host-resolver domain:ip` into its parts. Split on the *first* colon so an
 * IPv6 target (which itself contains colons) still works — only the IP side may contain
 * further colons, domains never do.
 */
export function parseHostResolverRule(raw: string): {
  domain: string;
  ip: string;
} {
  const idx = raw.indexOf(':');
  if (idx <= 0 || idx === raw.length - 1) {
    throw new Error(
      `--host-resolver must be in the form domain:ip (e.g. staging.example.com:203.0.113.5), got "${raw}"`,
    );
  }
  return { domain: raw.slice(0, idx), ip: raw.slice(idx + 1) };
}

/** Analysis flags that count as "the user already chose what to audit". */
const FLEET_ANALYSIS_FLAGS = [
  'contrast',
  'a11y',
  'perf',
  'seo',
  'schema',
  'fonts',
  'links',
  'meta',
  'report',
  'dom-stats',
  'lighthouse',
  'budget',
  'design',
  'design-audit',
  'speed',
  'responsive-check',
];

/**
 * Prepare CLI values for `looksy fleet <url...>`. Pure (mutates the passed `values`,
 * returns the resolved URL list) so it can be unit-tested without a browser.
 *
 * Collects URLs from positionals + any --urls, routes them through the existing
 * multi-domain batch (--urls), applies audit defaults when no analysis flag was given,
 * and turns the run into a gate (consolidated table + exit 1 on AA contrast failure).
 *
 * When no URLs were given at all, falls back to `./fleet.yaml` (or `values.fleet`)
 * so `looksy fleet` alone runs the whole domains x pages set from one config file.
 */
export function configureFleet(fleetUrls: string[], values: Record<string, any>): string[] {
  const fromUrls = values.urls
    ? String(values.urls)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  let all = [...fleetUrls.map((u) => u.trim()).filter(Boolean), ...fromUrls];

  // No URLs given (and no --url-file, handled separately downstream): fall back to
  // fleet.yaml — --fleet <path> overrides the default ./fleet.yaml location.
  if (all.length === 0 && !values['url-file']) {
    const fleetPath = values.fleet ? String(values.fleet) : './fleet.yaml';
    if (existsSync(fleetPath)) {
      const cfg = loadFleetConfig(fleetPath);
      all = expandFleetTargets(cfg);
      const hasMobile = cfg.viewports?.includes('mobile') ?? false;
      const hasDesktop = cfg.viewports?.includes('desktop') ?? false;
      if (hasMobile && hasDesktop) {
        if (!values.multi) values.multi = true;
      } else if (hasMobile) {
        if (!values.mobile) values.mobile = true;
      }
    }
  }

  // Route through the multi-domain batch path.
  values.urls = all.join(',');

  // Audit defaults: only when the caller didn't already pick an analysis mode.
  const hasAnalysis = FLEET_ANALYSIS_FLAGS.some((k) => values[k]);
  if (!hasAnalysis) {
    values.contrast = true;
    values.a11y = true;
    values.compact = true;
  }

  // Consolidated summary table + gate semantics (exit 1 on AA contrast failure).
  values['batch-report'] = true;
  values['fail-on-aa'] = true;

  return all;
}

export function parseViewport(raw: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(raw.trim());
  if (!m)
    throw new Error(`--viewport must be "<width>x<height>" of positive integers, got "${raw}"`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 1 || height < 1) throw new Error(`--viewport width/height must be ≥ 1, got "${raw}"`);
  return { width, height };
}

export function resolveViewport(values: Record<string, any>): Viewport {
  if (values.device) {
    if (
      values.mobile ||
      values.tablet ||
      values.width ||
      values.height ||
      values.viewport ||
      values.multi ||
      values.sweep
    ) {
      throw new Error(
        '--device cannot be combined with --mobile/--tablet/--width/--height/--viewport/--multi/--sweep',
      );
    }
    return descriptorViewport(String(values.device));
  }
  if (values.viewport) {
    if (values.width || values.height || values.mobile || values.tablet || values.device) {
      throw new Error(
        '--viewport cannot be combined with --width/--height/--mobile/--tablet/--device',
      );
    }
    return parseViewport(String(values.viewport));
  }
  let vp = viewports.desktop;
  if (values.mobile) vp = viewports.mobile;
  if (values.tablet) vp = viewports.tablet;
  if (values.width) {
    const w = validateNumeric('width', values.width);
    if (w < 1) {
      console.error('looksy: --width must be at least 1');
      process.exit(1);
    }
    vp = { ...vp, width: w };
  }
  if (values.height) {
    const h = validateNumeric('height', values.height);
    if (h < 1) {
      console.error('looksy: --height must be at least 1');
      process.exit(1);
    }
    vp = { ...vp, height: h };
  }
  return vp;
}
