import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadPNG } from './utils.js';
import { countChangedPixels } from './pixel-diff.js';

/**
 * Create a side-by-side before/after comparison PNG.
 * Left = before, right = after, thin red divider in the middle.
 */
export async function diffInline(
  beforePath: string,
  afterPath: string,
  outputPath: string,
): Promise<{ diffPath: string; changedPixels: number; totalPixels: number; changePercent: string }> {
  const { PNG } = await loadPNG();

  const before = PNG.sync.read(readFileSync(beforePath));
  const after = PNG.sync.read(readFileSync(afterPath));

  const dividerWidth = 4;
  const outWidth = before.width + dividerWidth + after.width;
  const outHeight = Math.max(before.height, after.height);
  const out = new PNG({ width: outWidth, height: outHeight });

  // Fill with dark gray background (for mismatched heights)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const idx = (y * outWidth + x) * 4;
      out.data[idx] = 30;
      out.data[idx + 1] = 30;
      out.data[idx + 2] = 30;
      out.data[idx + 3] = 255;
    }
  }

  // Copy "before" on the left
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      const srcIdx = (y * before.width + x) * 4;
      const dstIdx = (y * outWidth + x) * 4;
      out.data[dstIdx] = before.data[srcIdx];
      out.data[dstIdx + 1] = before.data[srcIdx + 1];
      out.data[dstIdx + 2] = before.data[srcIdx + 2];
      out.data[dstIdx + 3] = before.data[srcIdx + 3];
    }
  }

  // Red divider
  for (let y = 0; y < outHeight; y++) {
    for (let d = 0; d < dividerWidth; d++) {
      const idx = (y * outWidth + before.width + d) * 4;
      out.data[idx] = 255;
      out.data[idx + 1] = 60;
      out.data[idx + 2] = 60;
      out.data[idx + 3] = 255;
    }
  }

  // Copy "after" on the right
  for (let y = 0; y < after.height; y++) {
    for (let x = 0; x < after.width; x++) {
      const srcIdx = (y * after.width + x) * 4;
      const dstIdx = (y * outWidth + before.width + dividerWidth + x) * 4;
      out.data[dstIdx] = after.data[srcIdx];
      out.data[dstIdx + 1] = after.data[srcIdx + 1];
      out.data[dstIdx + 2] = after.data[srcIdx + 2];
      out.data[dstIdx + 3] = after.data[srcIdx + 3];
    }
  }

  // Count changed pixels in overlapping region
  const { changedPixels, totalPixels, changePercent } = countChangedPixels(before, after);

  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, PNG.sync.write(out));

  return { diffPath: outputPath, changedPixels, totalPixels, changePercent };
}

