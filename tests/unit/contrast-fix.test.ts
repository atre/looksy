import { describe, it, expect } from 'vitest';
import { suggestContrastFix, luminance, contrastRatio } from '../../src/contrast.js';

describe('suggestContrastFix', () => {
  it('suggests darkening bg for light fg on dark bg', () => {
    // White text on medium gray bg (fails AA)
    const fg: [number, number, number] = [255, 255, 255];
    const bg: [number, number, number] = [150, 150, 150];
    const fix = suggestContrastFix(fg, bg, 4.5);
    expect(fix).toBeTruthy();
    expect(fix!.type).toBe('bg');
    expect(fix!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('suggests darkening fg for dark fg on light bg', () => {
    // Gray text on white bg (fails AA)
    const fg: [number, number, number] = [150, 150, 150];
    const bg: [number, number, number] = [255, 255, 255];
    const fix = suggestContrastFix(fg, bg, 4.5);
    expect(fix).toBeTruthy();
    expect(fix!.type).toBe('fg');
    expect(fix!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('returns hex color in fix suggestion', () => {
    const fg: [number, number, number] = [255, 255, 255];
    const bg: [number, number, number] = [140, 158, 130]; // #8C9E82
    const fix = suggestContrastFix(fg, bg, 4.5);
    expect(fix).toBeTruthy();
    expect(fix!.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('verifies suggested fix actually passes target ratio', () => {
    const fg: [number, number, number] = [200, 200, 200];
    const bg: [number, number, number] = [100, 100, 100];
    const fix = suggestContrastFix(fg, bg, 4.5);
    if (fix) {
      // Parse the suggested hex and verify the ratio
      const hex = fix.hex;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const newLum = luminance(r, g, b);
      const otherLum = fix.type === 'bg' ? luminance(...fg) : luminance(...bg);
      const ratio = contrastRatio(newLum, otherLum);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reports a direction (darken/lighten)', () => {
    const fix = suggestContrastFix([150, 150, 150], [255, 255, 255], 4.5);
    expect(fix).toBeTruthy();
    expect(['darken', 'lighten']).toContain(fix!.direction);
  });

  it('lightens when darkening cannot reach target (dark text on dark bg)', () => {
    // #333 on #222: darkening either side toward black tops out well below 4.5:1.
    // The original (darken-only) returned null here → generic advice. Now it lightens.
    const fg: [number, number, number] = [0x33, 0x33, 0x33];
    const bg: [number, number, number] = [0x22, 0x22, 0x22];
    const fix = suggestContrastFix(fg, bg, 4.5);
    expect(fix).toBeTruthy();
    expect(fix!.direction).toBe('lighten');
    // The suggested color must actually pass against the side it didn't change.
    const r = parseInt(fix!.hex.slice(1, 3), 16);
    const g = parseInt(fix!.hex.slice(3, 5), 16);
    const b = parseInt(fix!.hex.slice(5, 7), 16);
    const otherLum = fix!.type === 'bg' ? luminance(...fg) : luminance(...bg);
    expect(contrastRatio(luminance(r, g, b), otherLum)).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens the background for white text on a light-gray bg (minimal change)', () => {
    const fix = suggestContrastFix([255, 255, 255], [150, 150, 150], 4.5);
    expect(fix!.type).toBe('bg');
    expect(fix!.direction).toBe('darken');
  });
});
