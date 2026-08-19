import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { validateBaselineName, loadPNG, LOOKSY_DIR } from './utils.js';
import { countChangedPixels, type PixelDiffResult } from './pixel-diff.js';
import { buildRegionsFromGrid, type Region } from './diff-attribution.js';

const BASELINES_DIR = `${LOOKSY_DIR}/baselines`;

const DEFAULT_REGION_CELL_SIZE = 16;

export interface DiffOptions {
  /**
   * When true, cluster changed pixels into bounding-box regions (grid-based, merged) for
   * diff-attribution while walking the diff canvas. Off by default so the hot path
   * (no attribution requested) doesn't pay for the grid allocation/bookkeeping.
   */
  collectRegions?: boolean;
  /** Grid cell size in px used when collectRegions is true. Default 16. */
  cellSize?: number;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Save a screenshot as a named baseline.
 */
export function saveBaseline(imagePath: string, name: string): string {
  validateBaselineName(name);
  ensureDir(BASELINES_DIR);
  const dest = resolve(BASELINES_DIR, `${name}.png`);
  const data = readFileSync(imagePath);
  writeFileSync(dest, data);
  return dest;
}

/**
 * Compare two local image files (PNG) with pixel-level diff.
 * Returns path to diff image + summary stats.
 */
export async function diffFiles(
  beforePath: string,
  afterPath: string,
  outputPath: string,
  options: DiffOptions = {},
): Promise<{ diffPath: string; regions?: Region[] } & PixelDiffResult> {
  if (!existsSync(beforePath)) throw new Error(`File not found: ${beforePath}`);
  if (!existsSync(afterPath)) throw new Error(`File not found: ${afterPath}`);

  const { PNG } = await loadPNG();
  const before = PNG.sync.read(readFileSync(beforePath));
  const after = PNG.sync.read(readFileSync(afterPath));

  return computeDiff(before, after, outputPath, options);
}

/**
 * Compare a screenshot against a saved baseline using pixel-level diff.
 * Pure TypeScript — no external dependencies.
 * Returns path to diff image + summary stats.
 */
export async function diffBaseline(
  currentPath: string,
  name: string,
  outputPath: string,
  options: DiffOptions = {},
): Promise<{ diffPath: string; baselinePath: string; regions?: Region[] } & PixelDiffResult> {
  validateBaselineName(name);
  const baselinePath = resolve(BASELINES_DIR, `${name}.png`);
  if (!existsSync(baselinePath)) {
    throw new Error(`No baseline "${name}" found. Run: looksy save <url> ${name}`);
  }

  const { PNG } = await loadPNG();

  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const current = PNG.sync.read(readFileSync(currentPath));

  const result = await computeDiff(baseline, current, outputPath, options);
  return { ...result, baselinePath };
}

async function computeDiff(
  imgA: any,
  imgB: any,
  outputPath: string,
  options: DiffOptions = {},
): Promise<{ diffPath: string; regions?: Region[] } & PixelDiffResult> {
  const { PNG } = await loadPNG();

  // Canvas spans the union bounding box so a grown/shrunk image doesn't get silently
  // cropped to the overlap — non-overlap regions are painted in the diff color below
  // (they're "changed" per countChangedPixels), keeping the image coherent with the stats.
  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);

  const diffImg = new PNG({ width, height });

  // Only allocated when attribution is requested — keeps the default path's perf intact.
  const cellSize = options.cellSize ?? DEFAULT_REGION_CELL_SIZE;
  const dirtyGrid: boolean[][] | undefined = options.collectRegions
    ? Array.from({ length: Math.ceil(height / cellSize) }, () =>
        new Array(Math.ceil(width / cellSize)).fill(false),
      )
    : undefined;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const inA = x < imgA.width && y < imgA.height;
      const inB = x < imgB.width && y < imgB.height;

      if (inA && inB) {
        const aIdx = (y * imgA.width + x) * 4;
        const bIdx = (y * imgB.width + x) * 4;

        const dr = Math.abs(imgA.data[aIdx] - imgB.data[bIdx]);
        const dg = Math.abs(imgA.data[aIdx + 1] - imgB.data[bIdx + 1]);
        const db = Math.abs(imgA.data[aIdx + 2] - imgB.data[bIdx + 2]);

        if (dr + dg + db > 30) {
          diffImg.data[idx] = 255;
          diffImg.data[idx + 1] = 60;
          diffImg.data[idx + 2] = 60;
          diffImg.data[idx + 3] = 255;
          if (dirtyGrid) dirtyGrid[(y / cellSize) | 0][(x / cellSize) | 0] = true;
        } else {
          diffImg.data[idx] = Math.floor(imgB.data[bIdx] * 0.3);
          diffImg.data[idx + 1] = Math.floor(imgB.data[bIdx + 1] * 0.3);
          diffImg.data[idx + 2] = Math.floor(imgB.data[bIdx + 2] * 0.3);
          diffImg.data[idx + 3] = 255;
        }
      } else if (inA || inB) {
        // Present in only one image (outside the overlap, inside the union) — changed.
        diffImg.data[idx] = 255;
        diffImg.data[idx + 1] = 60;
        diffImg.data[idx + 2] = 60;
        diffImg.data[idx + 3] = 255;
        if (dirtyGrid) dirtyGrid[(y / cellSize) | 0][(x / cellSize) | 0] = true;
      } else {
        // Outside both images — the bounding box's corner gap when the union isn't a
        // rectangle (e.g. width and height both differ). Not part of either image.
        diffImg.data[idx] = 20;
        diffImg.data[idx + 1] = 20;
        diffImg.data[idx + 2] = 20;
        diffImg.data[idx + 3] = 255;
      }
    }
  }

  ensureDir(dirname(outputPath));
  writeFileSync(outputPath, PNG.sync.write(diffImg));

  const result = countChangedPixels(imgA, imgB);
  const regions = dirtyGrid ? buildRegionsFromGrid(dirtyGrid, cellSize, width, height) : undefined;
  return { diffPath: outputPath, ...result, ...(regions ? { regions } : {}) };
}

/**
 * List all saved baselines.
 */
export function listBaselines(): string[] {
  if (!existsSync(BASELINES_DIR)) return [];
  return readdirSync(BASELINES_DIR)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace('.png', ''));
}
