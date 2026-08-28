import { loadPNG } from './utils.js';

/** Threshold for counting a pixel as "changed" (sum of RGB deltas). */
const DIFF_THRESHOLD = 30;

export interface PixelDiffResult {
  changedPixels: number;
  totalPixels: number;
  changePercent: string;
  /** True when imgA and imgB dimensions differ — non-overlap area was counted as changed. */
  dimensionMismatch?: boolean;
  baselineWidth?: number;
  baselineHeight?: number;
  currentWidth?: number;
  currentHeight?: number;
}

/**
 * Count changed pixels between two PNG image buffers.
 * Shared between diff.ts, diff-inline.ts, and watch.ts.
 *
 * When dimensions differ, only the top-left overlapping region can be pixel-compared.
 * Rather than silently reporting a near-0% change on a page that grew/shrank, every
 * pixel outside the overlap is counted as changed (against the union of both areas) —
 * so a resized page naturally fails downstream thresholds (e.g. the `guard` gate)
 * instead of masking the change. A warning is printed to stderr in that case.
 */
export function countChangedPixels(
  imgA: { data: Buffer; width: number; height: number },
  imgB: { data: Buffer; width: number; height: number },
): PixelDiffResult {
  const overlapWidth = Math.min(imgA.width, imgB.width);
  const overlapHeight = Math.min(imgA.height, imgB.height);
  let changedPixels = 0;

  for (let y = 0; y < overlapHeight; y++) {
    for (let x = 0; x < overlapWidth; x++) {
      const aIdx = (y * imgA.width + x) * 4;
      const bIdx = (y * imgB.width + x) * 4;
      const dr = Math.abs(imgA.data[aIdx] - imgB.data[bIdx]);
      const dg = Math.abs(imgA.data[aIdx + 1] - imgB.data[bIdx + 1]);
      const db = Math.abs(imgA.data[aIdx + 2] - imgB.data[bIdx + 2]);
      if (dr + dg + db > DIFF_THRESHOLD) changedPixels++;
    }
  }

  const dimensionMismatch = imgA.width !== imgB.width || imgA.height !== imgB.height;

  if (!dimensionMismatch) {
    const totalPixels = overlapWidth * overlapHeight;
    const changePercent =
      totalPixels > 0 ? ((changedPixels / totalPixels) * 100).toFixed(2) : '0.00';
    return { changedPixels, totalPixels, changePercent };
  }

  // Dimensions differ: every pixel outside the overlap (in either image but not both)
  // counts as changed, against the union area (inclusion-exclusion: |A|+|B|-|A∩B|).
  const areaA = imgA.width * imgA.height;
  const areaB = imgB.width * imgB.height;
  const overlapArea = overlapWidth * overlapHeight;
  const nonOverlapArea = areaA + areaB - 2 * overlapArea;
  const totalPixels = areaA + areaB - overlapArea;
  changedPixels += nonOverlapArea;
  const changePercent = totalPixels > 0 ? ((changedPixels / totalPixels) * 100).toFixed(2) : '0.00';

  console.error(
    `looksy: dimension mismatch — baseline ${imgA.width}x${imgA.height} vs current ${imgB.width}x${imgB.height}; non-overlapping area counted as changed`,
  );

  return {
    changedPixels,
    totalPixels,
    changePercent,
    dimensionMismatch: true,
    baselineWidth: imgA.width,
    baselineHeight: imgA.height,
    currentWidth: imgB.width,
    currentHeight: imgB.height,
  };
}

/**
 * Load a PNG file and return its pixel data.
 */
export async function loadPNGFile(
  filePath: string,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { readFileSync } = await import('node:fs');
  const { PNG } = await loadPNG();
  return PNG.sync.read(readFileSync(filePath));
}
