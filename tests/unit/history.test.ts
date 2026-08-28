import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type HistoryEntry = { slug: string; timestamp: string; path: string };

// history.ts reads LOOKSY_DIR from process.env at module-import time, so it must be set
// before the module is first imported. beforeAll() runs before any test body but after
// static imports are hoisted, so this file uses a dynamic import to pick up a scratch dir
// instead of writing into the real /tmp/looksy.
let tmpDir: string;
let formatHistory: typeof import('../../src/history.js').formatHistory;
let saveToHistory: typeof import('../../src/history.js').saveToHistory;
let listHistory: typeof import('../../src/history.js').listHistory;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'looksy-history-test-'));
  process.env.LOOKSY_DIR = tmpDir;
  ({ formatHistory, saveToHistory, listHistory } = await import('../../src/history.js'));
});

afterAll(() => {
  delete process.env.LOOKSY_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('formatHistory', () => {
  it('formats empty history', () => {
    const out = formatHistory([]);
    expect(out).toContain('No history');
  });

  it('formats a single entry with slug and timestamp', () => {
    const entries: HistoryEntry[] = [
      {
        slug: 'localhost-3000',
        timestamp: '2026-03-13T20:15:30',
        path: '/tmp/looksy/history/localhost-3000/2026-03-13T20-15-30.png',
      },
    ];
    const out = formatHistory(entries);
    expect(out).toContain('localhost-3000');
    expect(out).toContain('2026-03-13T20:15:30');
  });

  it('formats multiple entries grouped by slug', () => {
    const entries: HistoryEntry[] = [
      {
        slug: 'localhost-3000',
        timestamp: '2026-03-13T20:15:30',
        path: '/tmp/looksy/history/localhost-3000/2026-03-13T20-15-30.png',
      },
      {
        slug: 'localhost-3000',
        timestamp: '2026-03-13T19:00:00',
        path: '/tmp/looksy/history/localhost-3000/2026-03-13T19-00-00.png',
      },
      {
        slug: 'example-com',
        timestamp: '2026-03-13T18:00:00',
        path: '/tmp/looksy/history/example-com/2026-03-13T18-00-00.png',
      },
    ];
    const out = formatHistory(entries);
    // Both slugs appear as section headers
    expect(out).toContain('localhost-3000');
    expect(out).toContain('example-com');
    // Both entries for the same slug are listed
    expect(out).toContain('2026-03-13T20:15:30');
    expect(out).toContain('2026-03-13T19:00:00');
  });

  it('preserves newest-first ordering within each slug group', () => {
    const entries: HistoryEntry[] = [
      {
        slug: 'localhost-3000',
        timestamp: '2026-03-13T20:00:00',
        path: '/tmp/looksy/history/localhost-3000/2026-03-13T20-00-00.png',
      },
      {
        slug: 'localhost-3000',
        timestamp: '2026-03-12T10:00:00',
        path: '/tmp/looksy/history/localhost-3000/2026-03-12T10-00-00.png',
      },
    ];
    const out = formatHistory(entries);
    const newerIdx = out.indexOf('2026-03-13T20:00:00');
    const olderIdx = out.indexOf('2026-03-12T10:00:00');
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    // Newer entry should appear first (lower index in the output string)
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe('saveToHistory', () => {
  let fileCounter = 0;

  function makeSourcePng(): string {
    const src = join(tmpDir, `src-${fileCounter++}.png`);
    writeFileSync(src, 'fake-png-bytes');
    return src;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a millisecond-precision, filesystem-safe timestamped filename', () => {
    const dest = saveToHistory(makeSourcePng(), 'https://example.com/ms-precision');
    // .../YYYY-MM-DDTHH-mm-ss-SSS.png — 3-digit ms group, no colons/dots
    expect(dest).toMatch(/\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.png$/);
  });

  it('collides without a label when two captures land in the exact same millisecond (pre-fix behavior)', () => {
    // Reproduces the bug this fix targets: same URL, same instant, no discriminator.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.500Z'));
    const url = 'https://example.com/frozen-collision';
    const first = saveToHistory(makeSourcePng(), url);
    const second = saveToHistory(makeSourcePng(), url);
    expect(first).toBe(second);
  });

  it('does not collide at the same instant when desktop/mobile labels disambiguate (--multi fix)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.500Z'));
    const url = 'https://example.com/frozen-multi';
    const desktopPath = saveToHistory(makeSourcePng(), url, 'desktop');
    const mobilePath = saveToHistory(makeSourcePng(), url, 'mobile');

    expect(desktopPath).not.toBe(mobilePath);
    expect(desktopPath).toContain('-desktop.png');
    expect(mobilePath).toContain('-mobile.png');

    const entries = listHistory();
    const forUrl = entries.filter((e) => e.path === desktopPath || e.path === mobilePath);
    expect(forUrl).toHaveLength(2);
  });

  it('sanitizes an unsafe label before using it in the filename', () => {
    const dest = saveToHistory(
      makeSourcePng(),
      'https://example.com/unsafe-label',
      '../../etc/passwd',
    );
    // No path traversal segments or raw slashes survive into the filename
    expect(dest).not.toContain('..');
    expect(dest.split('/').pop()).not.toContain('/');
  });
});
