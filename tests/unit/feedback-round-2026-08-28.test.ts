import { describe, it, expect } from 'vitest';
import { formatPageLine } from '../../src/cli-output.js';
import {
  parseCrop,
  assertNotBothAndDark,
  thumbDimensions,
} from '../../src/cli-utils.js';
import type { ScreenshotResult } from '../../src/screenshot.js';

// FEEDBACK 2026-08-22 (docforum UI polish round, dogfood from ~/git/docforum):
// headless Chromium defaults to prefers-color-scheme: light, so a dark-default
// app's first "before" capture silently renders light unless the scheme is
// named in the output. plans/2026-08-28-scheme-thumb-crop.md items 1-5.

describe('Page header names the rendered color scheme', () => {
  it('includes "scheme: dark" when the capture emulated dark', () => {
    const result = {
      imagePath: '/tmp/x.png',
      scheme: 'dark',
      pageInfo: { width: 1280, height: 800, title: 'Home', viewportWidth: 1280 },
    } as unknown as ScreenshotResult;
    expect(formatPageLine(result)).toContain('scheme: dark');
  });

  it('includes "scheme: light" when the capture emulated light', () => {
    const result = {
      imagePath: '/tmp/x.png',
      scheme: 'light',
      pageInfo: { width: 1280, height: 800, title: 'Home', viewportWidth: 1280 },
    } as unknown as ScreenshotResult;
    expect(formatPageLine(result)).toContain('scheme: light');
  });

  it('omits the scheme segment entirely when scheme is unset (old fixtures)', () => {
    const result = {
      imagePath: '/tmp/x.png',
      pageInfo: { width: 1280, height: 800, title: 'Home', viewportWidth: 1280 },
    } as unknown as ScreenshotResult;
    expect(formatPageLine(result)).not.toContain('scheme:');
  });
});

describe('assertNotBothAndDark', () => {
  it('throws when --both and --dark are both set', () => {
    expect(() => assertNotBothAndDark(true, true)).toThrow(/--both/);
  });

  it('does not throw for --both alone or --dark alone or neither', () => {
    expect(() => assertNotBothAndDark(true, false)).not.toThrow();
    expect(() => assertNotBothAndDark(false, true)).not.toThrow();
    expect(() => assertNotBothAndDark(false, false)).not.toThrow();
  });
});

describe('parseCrop', () => {
  it('parses "x,y,w,h" into a clip region', () => {
    expect(parseCrop('10,20,300,150')).toEqual({ x: 10, y: 20, width: 300, height: 150 });
  });

  it('rejects a malformed value', () => {
    expect(() => parseCrop('bad')).toThrow(/--crop must be/);
  });

  it('rejects a zero width or height', () => {
    expect(() => parseCrop('0,0,0,150')).toThrow(/--crop width\/height must be > 0/);
  });
});

describe('thumbDimensions', () => {
  it('scales height by the same ratio as --micro (640px fixed case)', () => {
    // --micro's own math: ratio = 640/1280 = 0.5 → height halves.
    expect(thumbDimensions(1280, 800, 640)).toEqual({ width: 640, height: 400 });
  });

  it('supports an arbitrary target width', () => {
    expect(thumbDimensions(1280, 800, 320)).toEqual({ width: 320, height: 200 });
  });
});
