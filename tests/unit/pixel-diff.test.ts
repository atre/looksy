import { describe, it, expect, vi, afterEach } from 'vitest';
import { countChangedPixels } from '../../src/pixel-diff.js';

/** Build an RGBA image where every pixel has the given color. */
function img(width: number, height: number, [r, g, b, a = 255]: number[]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

describe('countChangedPixels', () => {
  it('reports 0 changes for identical images', () => {
    const r = countChangedPixels(img(2, 2, [10, 20, 30]), img(2, 2, [10, 20, 30]));
    expect(r.changedPixels).toBe(0);
    expect(r.totalPixels).toBe(4);
    expect(r.changePercent).toBe('0.00');
  });

  it('counts every pixel when all differ beyond threshold', () => {
    const r = countChangedPixels(img(2, 2, [0, 0, 0]), img(2, 2, [100, 100, 100]));
    expect(r.changedPixels).toBe(4);
    expect(r.changePercent).toBe('100.00');
  });

  it('ignores deltas at or below the threshold (sum 30)', () => {
    expect(countChangedPixels(img(1, 1, [0, 0, 0]), img(1, 1, [10, 10, 10])).changedPixels).toBe(0);
  });

  it('counts a delta just over the threshold (sum 31)', () => {
    expect(countChangedPixels(img(1, 1, [0, 0, 0]), img(1, 1, [10, 10, 11])).changedPixels).toBe(1);
  });

  it('returns 0.00 percent for a zero-area image', () => {
    const r = countChangedPixels(img(0, 0, [0, 0, 0]), img(0, 0, [0, 0, 0]));
    expect(r.totalPixels).toBe(0);
    expect(r.changePercent).toBe('0.00');
  });

  describe('dimension mismatch', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('counts non-overlap area as changed against the union, on top of overlap diffs', () => {
      // 3x3 black vs 2x2 white: overlap (2x2) is fully different; union = 9+4-4 = 9.
      const r = countChangedPixels(img(3, 3, [0, 0, 0]), img(2, 2, [200, 200, 200]));
      expect(r.totalPixels).toBe(9); // union: areaA(9) + areaB(4) - overlap(4)
      // overlap diff (4, all changed) + non-overlap (9+4-2*4=5) = 9
      expect(r.changedPixels).toBe(9);
      expect(r.changePercent).toBe('100.00');
      expect(r.dimensionMismatch).toBe(true);
    });

    it('flags a taller current image: change% reflects the non-overlap growth, not just overlap diffs', () => {
      // Baseline 2x2 and current 2x5 are identical color everywhere (overlap has 0 diff),
      // so any reported change is purely from the grown, non-overlapping region.
      const baseline = img(2, 2, [10, 20, 30]);
      const current = img(2, 5, [10, 20, 30]);
      const r = countChangedPixels(baseline, current);

      expect(r.dimensionMismatch).toBe(true);
      expect(r.baselineWidth).toBe(2);
      expect(r.baselineHeight).toBe(2);
      expect(r.currentWidth).toBe(2);
      expect(r.currentHeight).toBe(5);

      // union = areaA(4) + areaB(10) - overlap(4) = 10; non-overlap = 4+10-2*4 = 6
      expect(r.totalPixels).toBe(10);
      expect(r.changedPixels).toBe(6);
      expect(r.changePercent).toBe('60.00');
      // A near-0% "PASS" would silently mask this growth — must not happen.
      expect(r.changePercent).not.toBe('0.00');
    });

    it('prints one clear warning line to stderr on mismatch, and stays silent when dims match', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      countChangedPixels(img(2, 2, [0, 0, 0]), img(2, 2, [0, 0, 0]));
      expect(errSpy).not.toHaveBeenCalled();

      countChangedPixels(img(2, 2, [0, 0, 0]), img(2, 5, [0, 0, 0]));
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('looksy: dimension mismatch — baseline 2x2 vs current 2x5'),
      );
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-overlapping area counted as changed'),
      );
    });
  });

  describe('equal dimensions (unchanged behavior)', () => {
    it('omits dimensionMismatch and dimension fields when sizes match', () => {
      const r = countChangedPixels(img(2, 2, [10, 20, 30]), img(2, 2, [10, 20, 30]));
      expect(r.dimensionMismatch).toBeUndefined();
      expect(r.baselineWidth).toBeUndefined();
      expect(r.currentWidth).toBeUndefined();
    });

    it('totalPixels is plain width*height (no union math) when dims match', () => {
      const r = countChangedPixels(img(4, 3, [0, 0, 0]), img(4, 3, [100, 100, 100]));
      expect(r.totalPixels).toBe(12);
      expect(r.changedPixels).toBe(12);
      expect(r.changePercent).toBe('100.00');
    });
  });
});
