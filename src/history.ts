import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { LOOKSY_DIR } from './utils.js';

const HISTORY_DIR = `${LOOKSY_DIR}/history`;

function ensureDirs(): void {
  if (!existsSync(LOOKSY_DIR)) mkdirSync(LOOKSY_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Derive a filesystem-safe slug from a URL.
 * Takes hostname + pathname, replaces non-alphanumeric chars with hyphens,
 * collapses repeated hyphens, strips leading/trailing hyphens, truncates to 60 chars.
 */
function urlToSlug(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Fallback for non-URL strings: sanitize as-is
    return (
      url
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'unknown'
    );
  }
  const raw = parsed.hostname + parsed.pathname;
  return (
    raw
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'unknown'
  );
}

/**
 * Format a Date as a filesystem-safe ISO timestamp, millisecond-precision.
 * Replaces colons and the decimal point with dashes: 2026-03-13T20:15:30.123Z → 2026-03-13T20-15-30-123
 * (Second-precision let parallel captures of the same URL — e.g. --multi's desktop+mobile
 * Promise.all — collide when both landed in the same second; ms precision plus the
 * optional label param on saveToHistory close that window.)
 */
function toFilesafeTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/Z$/, '') // strip trailing Z
    .replace(/[:.]/g, '-'); // 2026-03-13T20-15-30-123
}

/**
 * Parse a filesystem-safe timestamp — optionally followed by a `-label` discriminator —
 * back to an ISO-ish string.
 * 2026-03-13T20-15-30-123 → 2026-03-13T20:15:30.123
 * 2026-03-13T20-15-30-123-desktop → 2026-03-13T20:15:30.123
 */
function fromFilesafeTimestamp(filename: string): string {
  const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');
  const match = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})(?:-.+)?$/);
  if (!match) return base; // unrecognized format (e.g. pre-existing second-precision entry) — pass through
  const [, date, hh, mm, ss, ms] = match;
  return `${date}T${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Save a screenshot to the history timeline.
 * `label` is an optional discriminator (e.g. 'desktop'/'mobile') appended to the
 * filename so two captures of the same URL that land in the same millisecond —
 * e.g. --multi's desktop+mobile Promise.all — still get distinct entries instead
 * of one overwriting the other.
 * Returns the path where it was saved.
 */
export function saveToHistory(imagePath: string, url: string, label?: string): string {
  ensureDirs();

  const slug = urlToSlug(url);
  const slugDir = resolve(HISTORY_DIR, slug);
  if (!existsSync(slugDir)) mkdirSync(slugDir, { recursive: true });

  const ext = extname(imagePath) || '.png';
  const timestamp = toFilesafeTimestamp(new Date());
  const safeLabel = label
    ? `-${label
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')}`
    : '';
  const destFilename = `${timestamp}${safeLabel}${ext}`;
  const destPath = resolve(slugDir, destFilename);

  copyFileSync(imagePath, destPath);
  return destPath;
}

/**
 * List all history entries, optionally filtered by URL slug.
 * Returns entries sorted newest-first.
 */
export function listHistory(
  urlSlug?: string,
): Array<{ slug: string; timestamp: string; path: string }> {
  if (!existsSync(HISTORY_DIR)) return [];

  let slugs: string[];
  try {
    slugs = readdirSync(HISTORY_DIR).filter((name) => {
      const fullPath = resolve(HISTORY_DIR, name);
      try {
        return statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }

  if (urlSlug) {
    slugs = slugs.filter((s) => s === urlSlug);
  }

  const entries: Array<{ slug: string; timestamp: string; path: string }> = [];

  for (const slug of slugs) {
    const slugDir = resolve(HISTORY_DIR, slug);
    let files: string[];
    try {
      files = readdirSync(slugDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      entries.push({
        slug,
        timestamp: fromFilesafeTimestamp(file),
        path: resolve(slugDir, file),
      });
    }
  }

  // Sort newest-first by timestamp string (ISO format sorts lexicographically)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

/**
 * Get the Nth-to-last history entry for a URL.
 * n=1 means the most recent, n=2 means the one before that.
 */
export function getNthLastEntry(url: string, n: number): string | null {
  const slug = urlToSlug(url);
  const entries = listHistory(slug);
  if (entries.length === 0 || n < 1 || n > entries.length) return null;
  return entries[n - 1].path;
}

/**
 * Format history listing for display.
 */
export function formatHistory(
  entries: Array<{ slug: string; timestamp: string; path: string }>,
): string {
  if (entries.length === 0) return '## Capture History\n\nNo history entries found.';

  // Group by slug, preserving newest-first order within each group
  const groups = new Map<string, Array<{ timestamp: string; path: string }>>();
  for (const entry of entries) {
    if (!groups.has(entry.slug)) groups.set(entry.slug, []);
    groups.get(entry.slug)!.push({ timestamp: entry.timestamp, path: entry.path });
  }

  const lines: string[] = ['## Capture History'];
  for (const [slug, slugEntries] of groups) {
    lines.push('');
    lines.push(`### ${slug}`);
    slugEntries.forEach((e, i) => {
      lines.push(`  ${i + 1}. ${e.timestamp} → ${e.path}`);
    });
  }

  return lines.join('\n');
}
