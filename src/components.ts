import type { Page } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadPNG } from './utils.js';

export interface ComponentResult {
  selector: string;
  index: number;
  path: string;
  width: number;
  height: number;
}

/**
 * Screenshot multiple elements by CSS selector list.
 * Returns individual component PNGs + a grid composite.
 */
export async function captureComponents(
  page: Page,
  selectors: string,
  outputPath: string,
): Promise<{ components: ComponentResult[]; gridPath: string }> {
  const selectorList = selectors.split(',').map(s => s.trim()).filter(Boolean);
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const components: ComponentResult[] = [];
  const buffers: Buffer[] = [];
  const dimensions: Array<{ width: number; height: number }> = [];

  for (let i = 0; i < selectorList.length; i++) {
    const sel = selectorList[i];
    const element = await page.$(sel);
    if (!element) continue;

    const box = await element.boundingBox();
    if (!box || box.width < 1 || box.height < 1) continue;

    const compPath = outputPath.replace(/(\.[^.]+)$/, `-component-${i + 1}$1`);
    const buf = await element.screenshot({ type: 'png' });
    writeFileSync(compPath, buf);
    buffers.push(buf);
    dimensions.push({ width: Math.round(box.width), height: Math.round(box.height) });

    components.push({
      selector: sel,
      index: i + 1,
      path: compPath,
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  }

  // Build grid composite (2-column layout)
  const gridPath = outputPath.replace(/(\.[^.]+)$/, '-components-grid$1');

  if (buffers.length > 0) {
    const { PNG } = await loadPNG();
    const pngs = buffers.map(buf => PNG.sync.read(buf));

    const cols = Math.min(2, pngs.length);
    const gap = 8;
    const maxWidthPerCol = Math.max(...pngs.map(p => p.width));
    const totalWidth = maxWidthPerCol * cols + gap * (cols - 1);

    // Calculate rows
    const rows: Array<Array<{ png: any; idx: number }>> = [];
    let currentRow: Array<{ png: any; idx: number }> = [];
    for (let i = 0; i < pngs.length; i++) {
      currentRow.push({ png: pngs[i], idx: i });
      if (currentRow.length === cols) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    let totalHeight = 0;
    const rowHeights: number[] = [];
    for (const row of rows) {
      const maxH = Math.max(...row.map(r => r.png.height));
      rowHeights.push(maxH);
      totalHeight += maxH + gap;
    }
    totalHeight -= gap; // remove trailing gap

    const output = new PNG({ width: totalWidth, height: totalHeight });

    // Fill with dark background
    for (let y = 0; y < totalHeight; y++) {
      for (let x = 0; x < totalWidth; x++) {
        const idx = (y * totalWidth + x) * 4;
        output.data[idx] = 30;
        output.data[idx + 1] = 30;
        output.data[idx + 2] = 30;
        output.data[idx + 3] = 255;
      }
    }

    // Copy each component into the grid
    let offsetY = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const src = row[c].png;
        const offsetX = c * (maxWidthPerCol + gap);
        for (let y = 0; y < src.height && (offsetY + y) < totalHeight; y++) {
          for (let x = 0; x < src.width && (offsetX + x) < totalWidth; x++) {
            const srcIdx = (y * src.width + x) * 4;
            const dstIdx = ((offsetY + y) * totalWidth + offsetX + x) * 4;
            output.data[dstIdx] = src.data[srcIdx];
            output.data[dstIdx + 1] = src.data[srcIdx + 1];
            output.data[dstIdx + 2] = src.data[srcIdx + 2];
            output.data[dstIdx + 3] = 255;
          }
        }
      }
      offsetY += rowHeights[r] + gap;
    }

    writeFileSync(gridPath, PNG.sync.write(output));
  }

  return { components, gridPath };
}
