import type { ElementMeta } from './metadata.js';

/** A rectangular bounding box in pixel coordinates. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The subset of ElementMeta that attribution needs. Reuses metadata.ts's shape
 * (rect + styles) so callers can pass ElementMeta / SemanticSnapshot elements directly.
 */
export type AttributionElement = Pick<ElementMeta, 'tag' | 'selector' | 'rect'> & {
  styles?: Record<string, string>;
};

/** A single computed-style property that changed between baseline and current. */
export interface StyleDelta {
  prop: string;
  before: string;
  after: string;
}

export interface ElementAttribution {
  selector: string;
  tag: string;
  rect: { x: number; y: number; width: number; height: number };
  /** % of the element's own area covered by changed regions (0-100, capped). */
  overlapPct: number;
  /** Changed regions that intersect this element's rect. */
  regions: Region[];
  /** Computed-style properties that changed, when a baseline element with the same selector exists. */
  styleDeltas?: StyleDelta[];
}

const DEFAULT_CELL_SIZE = 16;

/**
 * Merge a grid of dirty cells (cell-grid coordinates, `grid[gridY][gridX]`) into
 * bounding-box regions in pixel space.
 *
 * Greedy maximal-rectangle scan: for each unvisited dirty cell, extend right as far as
 * still dirty+unvisited, then extend that whole row-span downward as far as every cell
 * in it stays dirty+unvisited. This isn't optimal rectangle decomposition (no need for
 * exact connected components per the design), but it's O(cells) and merges contiguous
 * blobs into a small number of boxes.
 */
export function buildRegionsFromGrid(
  grid: boolean[][],
  cellSize: number = DEFAULT_CELL_SIZE,
  imgWidth?: number,
  imgHeight?: number,
): Region[] {
  const gridHeight = grid.length;
  if (gridHeight === 0) return [];
  const gridWidth = grid[0]?.length ?? 0;
  if (gridWidth === 0) return [];

  const visited: boolean[][] = grid.map((row) => row.map(() => false));
  const regions: Region[] = [];

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      if (!grid[gy][gx] || visited[gy][gx]) continue;

      // Extend right along this row.
      let gx2 = gx;
      while (gx2 + 1 < gridWidth && grid[gy][gx2 + 1] && !visited[gy][gx2 + 1]) gx2++;

      // Extend down as long as the full [gx, gx2] span stays dirty+unvisited.
      let gy2 = gy;
      outer: while (gy2 + 1 < gridHeight) {
        const nextRow = gy2 + 1;
        for (let x = gx; x <= gx2; x++) {
          if (!grid[nextRow][x] || visited[nextRow][x]) break outer;
        }
        gy2++;
      }

      // Mark the rectangle visited.
      for (let y = gy; y <= gy2; y++) {
        for (let x = gx; x <= gx2; x++) visited[y][x] = true;
      }

      const x = gx * cellSize;
      const y = gy * cellSize;
      const width =
        imgWidth !== undefined
          ? Math.min((gx2 - gx + 1) * cellSize, imgWidth - x)
          : (gx2 - gx + 1) * cellSize;
      const height =
        imgHeight !== undefined
          ? Math.min((gy2 - gy + 1) * cellSize, imgHeight - y)
          : (gy2 - gy + 1) * cellSize;
      if (width > 0 && height > 0) regions.push({ x, y, width, height });
    }
  }

  return regions;
}

/**
 * Cluster a changed-pixel bitmap (`bitmap[y][x]`, true = pixel changed) into bounding-box
 * regions. Buckets pixels into `cellSize`px grid cells — a cell is dirty if any pixel
 * inside it changed — then merges adjacent dirty cells via buildRegionsFromGrid.
 */
export function clusterChangedRegions(
  bitmap: boolean[][],
  cellSize: number = DEFAULT_CELL_SIZE,
): Region[] {
  const height = bitmap.length;
  if (height === 0) return [];
  const width = bitmap[0]?.length ?? 0;
  if (width === 0) return [];

  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const grid: boolean[][] = Array.from({ length: gridHeight }, () =>
    new Array(gridWidth).fill(false),
  );

  for (let y = 0; y < height; y++) {
    const row = bitmap[y];
    const gy = Math.floor(y / cellSize);
    for (let x = 0; x < width; x++) {
      if (row[x]) grid[gy][Math.floor(x / cellSize)] = true;
    }
  }

  return buildRegionsFromGrid(grid, cellSize, width, height);
}

function intersectArea(
  a: { x: number; y: number; width: number; height: number },
  b: Region,
): number {
  const ix = Math.max(a.x, b.x);
  const iy = Math.max(a.y, b.y);
  const iw = Math.min(a.x + a.width, b.x + b.width) - ix;
  const ih = Math.min(a.y + a.height, b.y + b.height) - iy;
  if (iw <= 0 || ih <= 0) return 0;
  return iw * ih;
}

/**
 * Rank elements by how much of their area overlaps the given changed regions.
 * Only elements with positive overlap are returned, sorted by total overlap area
 * descending (ties broken by smaller — i.e. more specific — element area first, so a
 * nested child ranks above an ancestor container with the same overlap).
 *
 * Pure: no browser/DOM access, operates entirely on already-captured rect data.
 */
export function attributeChanges(
  regions: Region[],
  elements: AttributionElement[],
): ElementAttribution[] {
  type Scored = {
    el: AttributionElement;
    overlapArea: number;
    elArea: number;
    hitRegions: Region[];
  };
  const scored: Scored[] = [];

  for (const el of elements) {
    const { rect } = el;
    if (rect.width <= 0 || rect.height <= 0) continue;
    const elArea = rect.width * rect.height;
    let overlapArea = 0;
    const hitRegions: Region[] = [];
    for (const region of regions) {
      const a = intersectArea(rect, region);
      if (a > 0) {
        overlapArea += a;
        hitRegions.push(region);
      }
    }
    if (overlapArea <= 0) continue;
    scored.push({ el, overlapArea, elArea, hitRegions });
  }

  scored.sort((a, b) => {
    if (b.overlapArea !== a.overlapArea) return b.overlapArea - a.overlapArea;
    return a.elArea - b.elArea;
  });

  return scored.map(({ el, overlapArea, elArea, hitRegions }) => ({
    selector: el.selector,
    tag: el.tag,
    rect: el.rect,
    // Regions from clusterChangedRegions/buildRegionsFromGrid are non-overlapping, so this
    // is a true percentage; if a caller passes overlapping regions directly (item 1 allows
    // "a list of changed-region bounding boxes" as input) the sum could exceed 100 — capped.
    overlapPct: Math.min(100, Math.round((overlapArea / elArea) * 1000) / 10),
    regions: hitRegions,
  }));
}

/**
 * Diff two computed-style maps for the same element and return only the properties that
 * changed. Pure helper — used to attach style deltas once an element is matched by
 * selector across baseline/current metadata.
 */
export function diffElementStyles(
  before: Record<string, string> | undefined,
  after: Record<string, string> | undefined,
): StyleDelta[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const deltas: StyleDelta[] = [];
  for (const prop of keys) {
    const beforeVal = b[prop] ?? '';
    const afterVal = a[prop] ?? '';
    if (beforeVal !== afterVal) deltas.push({ prop, before: beforeVal, after: afterVal });
  }
  deltas.sort((x, y) => x.prop.localeCompare(y.prop));
  return deltas;
}

function overlapArea(attr: ElementAttribution): number {
  return (attr.overlapPct / 100) * attr.rect.width * attr.rect.height;
}

/**
 * Top-level entry point: attribute changed regions to elements from both baseline and
 * current metadata, and attach style deltas where a selector survived from before→after.
 *
 * - Elements present now (unchanged, moved, or added) are attributed against their
 *   current rects.
 * - Elements that existed in the baseline but no longer match any current selector
 *   (removed) are still attributed against their old rect, so a deleted element that
 *   explains a changed region isn't silently dropped.
 */
export function attributeDiff(
  regions: Region[],
  beforeElements: AttributionElement[],
  afterElements: AttributionElement[],
): ElementAttribution[] {
  const beforeBySelector = new Map(beforeElements.map((el) => [el.selector, el]));
  const afterSelectors = new Set(afterElements.map((el) => el.selector));

  const current = attributeChanges(regions, afterElements);
  for (const attr of current) {
    const beforeEl = beforeBySelector.get(attr.selector);
    if (!beforeEl) continue;
    const afterEl = afterElements.find((e) => e.selector === attr.selector);
    const deltas = diffElementStyles(beforeEl.styles, afterEl?.styles);
    if (deltas.length > 0) attr.styleDeltas = deltas;
  }

  const removedElements = beforeElements.filter((el) => !afterSelectors.has(el.selector));
  const removed = attributeChanges(regions, removedElements);

  return [...current, ...removed].sort((a, b) => overlapArea(b) - overlapArea(a));
}
