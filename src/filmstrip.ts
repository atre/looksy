import type { Page } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadPNG } from './utils.js';

export interface FilmstripConfig {
  frames: number;        // default 8
  duration: number;      // total capture time in ms, default 2000
  scroll?: number;       // if set, gradually scroll this many px during capture
}

/**
 * Capture multiple frames over a time window and stitch them
 * into a single horizontal filmstrip PNG (half-scale per frame).
 * Useful for seeing animations, transitions, and scroll behavior.
 */
export async function captureFilmstrip(
  page: Page,
  outputPath: string,
  config: FilmstripConfig = { frames: 8, duration: 2000 },
): Promise<string> {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { frames, duration, scroll } = config;
  const interval = frames > 1 ? duration / (frames - 1) : duration;
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

  // Capture frames as raw PNG buffers
  const frameBuffers: Buffer[] = [];

  for (let i = 0; i < frames; i++) {
    if (scroll) {
      const scrollY = Math.round((scroll / Math.max(frames - 1, 1)) * i);
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(50);
    }

    const buf = await page.screenshot({ type: 'png' });
    frameBuffers.push(buf);

    if (i < frames - 1) {
      await page.waitForTimeout(interval);
    }
  }

  // Stitch frames horizontally using pngjs
  const { PNG } = await loadPNG();
  const pngs = frameBuffers.map((buf) => PNG.sync.read(buf));

  // Half-scale each frame for readability
  const scale = 0.5;
  const frameW = Math.round(viewport.width * scale);
  const frameH = Math.round(viewport.height * scale);
  const gap = 4;
  const totalWidth = frameW * frames + gap * (frames - 1);

  const output = new PNG({ width: totalWidth, height: frameH });

  // Fill dark background
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < totalWidth; x++) {
      const idx = (y * totalWidth + x) * 4;
      output.data[idx] = 20;
      output.data[idx + 1] = 20;
      output.data[idx + 2] = 20;
      output.data[idx + 3] = 255;
    }
  }

  // Copy each frame with nearest-neighbor downscale
  for (let f = 0; f < frames; f++) {
    const src = pngs[f];
    const offsetX = f * (frameW + gap);

    for (let y = 0; y < frameH; y++) {
      const srcY = Math.min(Math.floor(y / scale), src.height - 1);
      for (let x = 0; x < frameW; x++) {
        const srcX = Math.min(Math.floor(x / scale), src.width - 1);
        const srcIdx = (srcY * src.width + srcX) * 4;
        const dstIdx = (y * totalWidth + offsetX + x) * 4;
        output.data[dstIdx] = src.data[srcIdx];
        output.data[dstIdx + 1] = src.data[srcIdx + 1];
        output.data[dstIdx + 2] = src.data[srcIdx + 2];
        output.data[dstIdx + 3] = 255;
      }
    }
  }

  writeFileSync(outputPath, PNG.sync.write(output));
  return outputPath;
}

