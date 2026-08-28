import { describe, it, expect } from 'vitest';
import {
  clusterChangedRegions,
  buildRegionsFromGrid,
  attributeChanges,
  diffElementStyles,
  attributeDiff,
  type Region,
  type AttributionElement,
} from '../../src/diff-attribution.js';

/** Build a height x width bitmap, all false, then flip the given [x,y] cells to true. */
function bitmap(width: number, height: number, on: [number, number][]): boolean[][] {
  const b = Array.from({ length: height }, () => new Array(width).fill(false));
  for (const [x, y] of on) b[y][x] = true;
  return b;
}

describe('clusterChangedRegions', () => {
  it('returns no regions for an empty bitmap', () => {
    expect(clusterChangedRegions([])).toEqual([]);
  });

  it('returns no regions when nothing changed', () => {
    const b = bitmap(32, 32, []);
    expect(clusterChangedRegions(b, 16)).toEqual([]);
  });

  it('clusters a single dirty pixel into one 16px-cell region', () => {
    const b = bitmap(32, 32, [[5, 5]]);
    const regions = clusterChangedRegions(b, 16);
    expect(regions).toEqual([{ x: 0, y: 0, width: 16, height: 16 }]);
  });

  it('merges a filled block spanning multiple cells into one bounding box', () => {
    // Mark every pixel in the top-left 32x32 block (2x2 grid of 16px cells) dirty.
    const on: [number, number][] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) on.push([x, y]);
    }
    const b = bitmap(32, 32, on);
    const regions = clusterChangedRegions(b, 16);
    expect(regions).toEqual([{ x: 0, y: 0, width: 32, height: 32 }]);
  });

  it('produces two separate regions for two disjoint blobs', () => {
    const b = bitmap(64, 64, [
      [1, 1], // top-left cell
      [60, 60], // bottom-right cell, far away
    ]);
    const regions = clusterChangedRegions(b, 16);
    expect(regions).toHaveLength(2);
    expect(regions).toContainEqual({ x: 0, y: 0, width: 16, height: 16 });
    expect(regions).toContainEqual({ x: 48, y: 48, width: 16, height: 16 });
  });

  it('clamps region bounds to the bitmap size (partial trailing cell)', () => {
    // 20x20 bitmap with cellSize 16 -> grid is 2x2 cells, last cell only 4px wide/tall.
    const b = bitmap(20, 20, [[18, 18]]);
    const regions = clusterChangedRegions(b, 16);
    expect(regions).toEqual([{ x: 16, y: 16, width: 4, height: 4 }]);
  });

  it('does not mutate the input bitmap', () => {
    const b = bitmap(16, 16, [[0, 0]]);
    const copy = b.map((row) => [...row]);
    clusterChangedRegions(b, 16);
    expect(b).toEqual(copy);
  });
});

describe('buildRegionsFromGrid', () => {
  it('returns no regions for an empty grid', () => {
    expect(buildRegionsFromGrid([])).toEqual([]);
    expect(buildRegionsFromGrid([[]])).toEqual([]);
  });

  it('merges an L-shaped dirty area into more than one rectangle without exceeding pixel bounds', () => {
    // 3x3 cell grid; dirty cells form an L: top row + left column.
    const grid = [
      [true, true, true],
      [true, false, false],
      [true, false, false],
    ];
    const regions = buildRegionsFromGrid(grid, 10, 30, 30);
    const totalArea = regions.reduce((s, r) => s + r.width * r.height, 0);
    // 5 dirty cells * 100px^2 each = 500; regions must cover exactly the dirty cells, no overlap.
    expect(totalArea).toBe(500);
    for (const r of regions) {
      expect(r.x + r.width).toBeLessThanOrEqual(30);
      expect(r.y + r.height).toBeLessThanOrEqual(30);
    }
  });
});

describe('attributeChanges', () => {
  const el = (selector: string, tag: string, rect: Region): AttributionElement => ({
    selector,
    tag,
    rect,
  });

  it('returns empty attributions for an empty diff', () => {
    expect(attributeChanges([], [])).toEqual([]);
    expect(attributeChanges([], [el('.a', 'div', { x: 0, y: 0, width: 10, height: 10 })])).toEqual(
      [],
    );
  });

  it('excludes elements that do not intersect any region', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    const elements = [el('.far', 'div', { x: 100, y: 100, width: 10, height: 10 })];
    expect(attributeChanges(regions, elements)).toEqual([]);
  });

  it('computes overlapPct as % of the element area covered by regions', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 5, height: 10 }]; // half of a 10x10 element
    const elements = [el('.half', 'div', { x: 0, y: 0, width: 10, height: 10 })];
    const result = attributeChanges(regions, elements);
    expect(result).toHaveLength(1);
    expect(result[0].overlapPct).toBe(50);
    expect(result[0].regions).toEqual(regions);
  });

  it('caps overlapPct at 100 when overlapping input regions double-count', () => {
    const regions: Region[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 }, // duplicate, overlapping itself
    ];
    const elements = [el('.full', 'div', { x: 0, y: 0, width: 10, height: 10 })];
    const result = attributeChanges(regions, elements);
    expect(result[0].overlapPct).toBe(100);
  });

  it('skips zero-area elements', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    const elements = [
      el('.collapsed', 'div', { x: 0, y: 0, width: 0, height: 10 }),
      el('.visible', 'div', { x: 0, y: 0, width: 10, height: 10 }),
    ];
    const result = attributeChanges(regions, elements);
    expect(result).toHaveLength(1);
    expect(result[0].selector).toBe('.visible');
  });

  it('ranks fully-overlapping elements above partially-overlapping ones (sorted by overlap area)', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 20, height: 20 }];
    const elements = [
      el('.small-full', 'span', { x: 0, y: 0, width: 5, height: 5 }), // fully covered, area 25
      el('.big-partial', 'section', { x: 10, y: 10, width: 20, height: 20 }), // overlap area 100
    ];
    const result = attributeChanges(regions, elements);
    expect(result.map((r) => r.selector)).toEqual(['.big-partial', '.small-full']);
  });

  it('breaks ties in overlap area by smaller (more specific) element first', () => {
    // A 4x4 region gives both elements the same 16px^2 overlap area, but the container
    // is much larger overall — the more specific (smaller) child should rank first.
    const regions: Region[] = [{ x: 0, y: 0, width: 4, height: 4 }];
    const elements = [
      el('.container', 'div', { x: 0, y: 0, width: 100, height: 100 }), // overlap 16, elArea 10000
      el('.child', 'button', { x: 0, y: 0, width: 4, height: 4 }), // overlap 16, elArea 16
    ];
    const result = attributeChanges(regions, elements);
    expect(result.map((r) => r.selector)).toEqual(['.child', '.container']);
  });

  it('overlapPct is bounded by 0 and 100 for a fully covered element', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    const elements = [el('.full', 'div', { x: 0, y: 0, width: 10, height: 10 })];
    const result = attributeChanges(regions, elements);
    expect(result[0].overlapPct).toBe(100);
  });
});

describe('diffElementStyles', () => {
  it('returns no deltas for identical style maps', () => {
    const styles = { color: 'red', padding: '16px' };
    expect(diffElementStyles(styles, { ...styles })).toEqual([]);
  });

  it('detects a changed property', () => {
    const before = { padding: '16px', color: 'red' };
    const after = { padding: '12px', color: 'red' };
    const deltas = diffElementStyles(before, after);
    expect(deltas).toEqual([{ prop: 'padding', before: '16px', after: '12px' }]);
  });

  it('detects an added property (missing before)', () => {
    const deltas = diffElementStyles({ color: 'red' }, { color: 'red', 'font-weight': 'bold' });
    expect(deltas).toContainEqual({ prop: 'font-weight', before: '', after: 'bold' });
  });

  it('detects a removed property (missing after)', () => {
    const deltas = diffElementStyles({ color: 'red', 'font-weight': 'bold' }, { color: 'red' });
    expect(deltas).toContainEqual({ prop: 'font-weight', before: 'bold', after: '' });
  });

  it('handles undefined inputs as empty style maps', () => {
    expect(diffElementStyles(undefined, undefined)).toEqual([]);
    expect(diffElementStyles(undefined, { color: 'red' })).toEqual([
      { prop: 'color', before: '', after: 'red' },
    ]);
  });

  it('returns deltas sorted by property name', () => {
    const deltas = diffElementStyles(
      { width: '10px', color: 'red', padding: '1px' },
      { width: '20px', color: 'blue', padding: '2px' },
    );
    expect(deltas.map((d) => d.prop)).toEqual(['color', 'padding', 'width']);
  });
});

describe('attributeDiff', () => {
  const el = (
    selector: string,
    tag: string,
    rect: Region,
    styles?: Record<string, string>,
  ): AttributionElement => ({ selector, tag, rect, styles });

  it('returns empty array when there are no changed regions', () => {
    const before = [el('.hero-cta', 'button', { x: 0, y: 0, width: 50, height: 20 })];
    const after = [el('.hero-cta', 'button', { x: 0, y: 0, width: 50, height: 20 })];
    expect(attributeDiff([], before, after)).toEqual([]);
  });

  it('excludes selectors present in both snapshots but unchanged in style and position', () => {
    // Region overlaps element A only; element B (unchanged, untouched region) must not appear.
    const regions: Region[] = [{ x: 0, y: 0, width: 20, height: 20 }];
    const before = [
      el('.a', 'div', { x: 0, y: 0, width: 20, height: 20 }, { color: 'red' }),
      el('.b', 'div', { x: 100, y: 100, width: 20, height: 20 }, { color: 'blue' }),
    ];
    const after = [
      el('.a', 'div', { x: 0, y: 0, width: 20, height: 20 }, { color: 'green' }),
      el('.b', 'div', { x: 100, y: 100, width: 20, height: 20 }, { color: 'blue' }),
    ];
    const result = attributeDiff(regions, before, after);
    expect(result).toHaveLength(1);
    expect(result[0].selector).toBe('.a');
    expect(result[0].styleDeltas).toEqual([{ prop: 'color', before: 'red', after: 'green' }]);
  });

  it('attaches style deltas only when the selector matches a baseline element', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 50, height: 20 }];
    const before = [
      el('.hero-cta', 'button', { x: 0, y: 0, width: 50, height: 20 }, { padding: '16px' }),
    ];
    const after = [
      el('.hero-cta', 'button', { x: 0, y: 0, width: 50, height: 20 }, { padding: '12px' }),
    ];
    const [attr] = attributeDiff(regions, before, after);
    expect(attr.selector).toBe('.hero-cta');
    expect(attr.styleDeltas).toEqual([{ prop: 'padding', before: '16px', after: '12px' }]);
  });

  it('leaves styleDeltas undefined for a new element with no baseline match', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 20, height: 20 }];
    const before: AttributionElement[] = [];
    const after = [
      el('.new-badge', 'span', { x: 0, y: 0, width: 20, height: 20 }, { color: 'red' }),
    ];
    const [attr] = attributeDiff(regions, before, after);
    expect(attr.selector).toBe('.new-badge');
    expect(attr.styleDeltas).toBeUndefined();
  });

  it('still attributes a removed element against its old rect', () => {
    const regions: Region[] = [{ x: 0, y: 0, width: 20, height: 20 }];
    const before = [el('.gone', 'div', { x: 0, y: 0, width: 20, height: 20 }, { color: 'red' })];
    const after: AttributionElement[] = [];
    const result = attributeDiff(regions, before, after);
    expect(result).toHaveLength(1);
    expect(result[0].selector).toBe('.gone');
    expect(result[0].rect).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it('empty diff (identical snapshots, no regions) yields empty attribution', () => {
    const same = [el('.x', 'div', { x: 0, y: 0, width: 10, height: 10 }, { color: 'red' })];
    expect(attributeDiff([], same, same)).toEqual([]);
  });
});
