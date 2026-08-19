/** Base directory — configurable via LOOKSY_DIR env var for persistent baselines in CI. */
export const LOOKSY_DIR = process.env.LOOKSY_DIR || '/tmp/looksy';

/** Format byte counts as human-readable strings. */
export function formatBytes(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Validate that a baseline name contains only safe filename characters. */
export function validateBaselineName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid baseline name "${name}". Use only letters, numbers, hyphens, and underscores.`,
    );
  }
}

/**
 * Escape a string for safe use inside a CSS attribute selector.
 * Prevents CSS selector injection via user-controlled patterns like `"]`.
 */
export function escapeCssAttrValue(value: string): string {
  return value.replace(/[\\"'\]]/g, (ch) => `\\${ch}`);
}

/** Dynamic import of pngjs — shared across diff, diff-inline, filmstrip, watch. */
export async function loadPNG(): Promise<any> {
  try {
    return await import('pngjs');
  } catch {
    throw new Error('pngjs is required. Run: npm install pngjs');
  }
}

/**
 * Map over items with a concurrency limit. Like Promise.all but caps parallelism.
 * Used by --pages and batch to prevent Chromium memory exhaustion.
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = Infinity,
): Promise<R[]> {
  if (concurrency === Infinity || concurrency >= items.length) {
    return Promise.all(items.map(fn));
  }
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Per-item outcome from pMapSettled — mirrors input order. */
export type Settled<R> = { ok: true; value: R } | { ok: false; error: Error };

/**
 * pMap with per-item error isolation: one failed item never aborts the rest.
 * Batch paths (--pages, --urls, fleet, batch) use this so a single flaky
 * target still yields results + a report for every healthy one.
 */
export async function pMapSettled<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = Infinity,
): Promise<Settled<R>[]> {
  return pMap(
    items,
    async (item): Promise<Settled<R>> => {
      try {
        return { ok: true, value: await fn(item) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    concurrency,
  );
}
