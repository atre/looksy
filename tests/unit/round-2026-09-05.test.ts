// Acceptance tests (unit half) for plans/2026-09-05-color4-and-local-files.md — failing at authoring time by design.
// Do not edit these while executing the plan; the plan is done when they pass unmodified.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUrl } from '../../dist/cli.js';
import * as contrast from '../../dist/contrast.js';
import * as cliOutput from '../../dist/cli-output.js';
import { summarize } from '../../dist/analysis-summary.js';

const parseRgb = (contrast as unknown as { parseRgb: (s: string) => [number, number, number] | null }).parseRgb;
const contrastGateFails = (cliOutput as unknown as { contrastGateFails: (f: { aa: number; aaa: number; unparsed?: number }, aa: boolean, aaa: boolean) => boolean }).contrastGateFails;

describe('P6 — bare local filename', () => {
  it('an existing file in cwd wins over the bare-domain reading; a missing one stays a domain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-bare-'));
    const prev = process.cwd();
    try {
      writeFileSync(join(dir, 'Stage.dc.html'), '<p>x</p>');
      process.chdir(dir);
      const url = resolveUrl('Stage.dc.html');
      expect(url.startsWith('file://')).toBe(true);
      expect(url.endsWith('/Stage.dc.html')).toBe(true);
      expect(resolveUrl('nope.dc.html')).toBe('https://nope.dc.html');
      expect(resolveUrl('example.com')).toBe('https://example.com');
    } finally {
      process.chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('P1 — colour parsing fails closed', () => {
  it('node-side parseRgb reads hex and modern rgb syntax (what the in-page normaliser emits)', () => {
    expect(parseRgb('#eaeaf0')).toEqual([234, 234, 240]);
    expect(parseRgb('#16161cff')).toEqual([22, 22, 28]);
    expect(parseRgb('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0]);
    expect(parseRgb('rgb(255 0 0 / 0.5)')).toEqual([255, 0, 0]);
    expect(parseRgb('oklch(0.94 0.006 265)')).toBeNull();
  });

  it('the summary line names unparsed colours and the AA gate fails closed on them', () => {
    const data = { text: '', aaFailures: 0, aaaFailures: 0, invisibleFailures: 0, pairs: [], sampled: 0, total: 3, capped: false, unparsed: 3 };
    expect(summarize('contrast', data as never)).toMatch(/contrast: 0 AA fail, 0 AAA fail \(0 checked, 3 unparsed\)/);
    expect(contrastGateFails({ aa: 0, aaa: 0, unparsed: 3 }, true, false)).toBe(true);
    expect(contrastGateFails({ aa: 0, aaa: 0, unparsed: 0 }, true, false)).toBe(false);
    expect(contrastGateFails({ aa: 1, aaa: 1, unparsed: 0 }, true, false)).toBe(true);
  });
});
