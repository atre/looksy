import { describe, it, expect } from 'vitest';
import {
  parseColor,
  hslToRgb,
  autoPairCssColors,
  loadThemeConfig,
} from '../../src/validate-theme.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseColor: HSL support', () => {
  it('parses hsl(h, s%, l%)', () => {
    const rgb = parseColor('hsl(0, 100%, 50%)');
    expect(rgb).toBeTruthy();
    expect(rgb![0]).toBe(255); // red
    expect(rgb![1]).toBe(0);
    expect(rgb![2]).toBe(0);
  });

  it('parses bare HSL (shadcn format): "0 0% 100%"', () => {
    const rgb = parseColor('0 0% 100%');
    expect(rgb).toBeTruthy();
    expect(rgb![0]).toBe(255);
    expect(rgb![1]).toBe(255);
    expect(rgb![2]).toBe(255);
  });

  it('parses bare HSL: "222.2 84% 4.9%"', () => {
    const rgb = parseColor('222.2 84% 4.9%');
    expect(rgb).toBeTruthy();
    // Should be a very dark blue
    expect(rgb![0]).toBeLessThan(10);
    expect(rgb![1]).toBeLessThan(15);
    expect(rgb![2]).toBeLessThan(25);
  });

  it('still parses hex colors', () => {
    expect(parseColor('#ff0000')).toEqual([255, 0, 0]);
    expect(parseColor('#f00')).toEqual([255, 0, 0]);
    expect(parseColor('#1a1a2e')).toEqual([26, 26, 46]);
  });

  it('still parses rgb() colors', () => {
    expect(parseColor('rgb(128, 64, 32)')).toEqual([128, 64, 32]);
  });
});

describe('hslToRgb', () => {
  it('converts pure red', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
  });

  it('converts pure green', () => {
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
  });

  it('converts white', () => {
    expect(hslToRgb(0, 0, 1)).toEqual([255, 255, 255]);
  });

  it('converts black', () => {
    expect(hslToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });
});

describe('autoPairCssColors', () => {
  it('pairs --X with --X-foreground (shadcn convention)', () => {
    const colors = {
      primary: '#1a1a2e',
      'primary-foreground': '#ffffff',
      secondary: '#333333',
      'secondary-foreground': '#eeeeee',
    };
    const pairs = autoPairCssColors(colors);
    expect(pairs.length).toBe(2);
    expect(pairs[0].label).toBe('--primary');
    expect(pairs[1].label).toBe('--secondary');
  });

  it('pairs --foreground on --background', () => {
    const colors = {
      foreground: '#1a1a1a',
      background: '#ffffff',
    };
    const pairs = autoPairCssColors(colors);
    expect(pairs.length).toBe(1);
    expect(pairs[0].label).toBe('foreground on background');
  });

  it('throws when no pairs can be detected, with an example config shape', () => {
    const colors = { 'random-value': '#ff0000' };
    expect(() => autoPairCssColors(colors)).toThrow('Could not auto-detect');
    expect(() => autoPairCssColors(colors)).toThrow('e.g. {"pairs":[{"fg":"#fff","bg":"#333"}]}');
  });

  it('handles mixed naming conventions', () => {
    const colors = {
      card: '#ffffff',
      'card-foreground': '#1a1a1a',
      foreground: '#000000',
      background: '#ffffff',
    };
    const pairs = autoPairCssColors(colors);
    expect(pairs.length).toBe(2);
  });
});

describe('loadThemeConfig: JSON error messages show the expected shape', () => {
  it('throws with an example config when "pairs" array is missing', () => {
    const configPath = join(tmpdir(), 'looksy-test-theme-no-pairs.json');
    writeFileSync(configPath, JSON.stringify({ notPairs: [] }));
    try {
      expect(() => loadThemeConfig(configPath)).toThrow(
        'Theme config must have a "pairs" array — e.g. {"pairs":[{"fg":"#fff","bg":"#333"}]}',
      );
    } finally {
      unlinkSync(configPath);
    }
  });

  it('throws with an example config when a color token is unknown', () => {
    const configPath = join(tmpdir(), 'looksy-test-theme-unknown-token.json');
    writeFileSync(configPath, JSON.stringify({ pairs: [{ fg: 'primary', bg: '#fff' }] }));
    try {
      expect(() => loadThemeConfig(configPath)).toThrow(
        'e.g. {"colors":{"primary":"#1a1a2e"},"pairs":[{"fg":"primary","bg":"bg"}]}',
      );
    } finally {
      unlinkSync(configPath);
    }
  });
});
