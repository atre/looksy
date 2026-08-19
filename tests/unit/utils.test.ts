import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  validateBaselineName,
  escapeCssAttrValue,
  pMap,
  pMapSettled,
} from '../../src/utils.js';

describe('formatBytes', () => {
  it('renders bytes under 1KB', () => expect(formatBytes(512)).toBe('512 B'));
  it('treats exactly 1024 as bytes (strict >)', () => expect(formatBytes(1024)).toBe('1024 B'));
  it('renders KB', () => expect(formatBytes(2048)).toBe('2.0 KB'));
  it('renders MB', () => expect(formatBytes(5 * 1048576)).toBe('5.0 MB'));
  it('renders zero', () => expect(formatBytes(0)).toBe('0 B'));
});

describe('validateBaselineName (path-traversal guard)', () => {
  it('accepts safe names', () => {
    expect(() => validateBaselineName('home-page_v2')).not.toThrow();
  });
  it('rejects traversal and separators', () => {
    for (const bad of ['../etc/passwd', 'a/b', 'a.b', '', 'a b', 'name;rm']) {
      expect(() => validateBaselineName(bad), bad).toThrow();
    }
  });
});

describe('escapeCssAttrValue (selector-injection guard)', () => {
  it('escapes quotes, backslash, and closing bracket', () => {
    expect(escapeCssAttrValue('a"]')).toBe('a\\"\\]');
    expect(escapeCssAttrValue("x'y")).toBe("x\\'y");
    expect(escapeCssAttrValue('a\\b')).toBe('a\\\\b');
  });
  it('leaves safe values unchanged', () => {
    expect(escapeCssAttrValue('hero-title')).toBe('hero-title');
  });
});

describe('pMap', () => {
  it('preserves order and maps every item', async () => {
    expect(await pMap([1, 2, 3, 4], async (n) => n * 2, 2)).toEqual([2, 4, 6, 8]);
  });

  it('fast path (concurrency >= length) preserves order', async () => {
    expect(await pMap([1, 2, 3], async (n) => n + 1, Infinity)).toEqual([2, 3, 4]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let max = 0;
    await pMap(
      [1, 2, 3, 4, 5, 6],
      async () => {
        active++;
        max = Math.max(max, active);
        await new Promise((res) => setTimeout(res, 10));
        active--;
      },
      2,
    );
    expect(max).toBeLessThanOrEqual(2);
    expect(max).toBeGreaterThan(0);
  });

  it('handles empty input', async () => {
    expect(await pMap([], async (x: number) => x, 3)).toEqual([]);
  });

  it('propagates errors from the mapper', async () => {
    await expect(
      pMap(
        [1, 2, 3],
        async (n) => {
          if (n === 2) throw new Error('boom');
          return n;
        },
        1,
      ),
    ).rejects.toThrow('boom');
  });
});

describe('pMapSettled', () => {
  it('isolates per-item failures — one throw never aborts the rest', async () => {
    const settled = await pMapSettled(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error('boom');
        return n * 10;
      },
      1,
    );
    expect(settled).toEqual([
      { ok: true, value: 10 },
      { ok: false, error: expect.any(Error) },
      { ok: true, value: 30 },
    ]);
    expect(settled[1].ok === false && settled[1].error.message).toBe('boom');
  });

  it('preserves input order under concurrency', async () => {
    const settled = await pMapSettled(
      [3, 1, 2],
      async (n) => {
        await new Promise((r) => setTimeout(r, n * 10));
        return n;
      },
      3,
    );
    expect(settled.map((s) => (s.ok ? s.value : null))).toEqual([3, 1, 2]);
  });

  it('wraps non-Error throws in Error', async () => {
    const settled = await pMapSettled([1], async () => {
      throw 'raw string';
    });
    expect(settled[0].ok).toBe(false);
    expect(settled[0].ok === false && settled[0].error).toBeInstanceOf(Error);
    expect(settled[0].ok === false && settled[0].error.message).toBe('raw string');
  });
});
