// Acceptance tests (integration half) for plans/2026-09-05-color4-and-local-files.md — real Chromium via bin/looksy.js.
// Failing at authoring time by design; the plan is done when they pass unmodified.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');
function runWithStdin(input: string, ...args: string[]) {
  return spawnSync('node', [BIN, ...args], { input, timeout: 30_000, encoding: 'utf-8' });
}
const OKLCH =
  '<body style="margin:0;background:oklch(0.18 0.012 265);color:oklch(0.94 0.006 265)"><p>One</p><p>Two</p></body>';
const HEX = '<body style="margin:0;background:#16161c;color:#eaeaf0"><p>One</p><p>Two</p></body>';
const checked = (s: string) =>
  Number(/contrast: \d+ AA fail, \d+ AAA fail \((\d+) checked/.exec(s)?.[1] ?? -1);

describe('P1 — CSS Color 4 pages are audited, not skipped', () => {
  it('an all-oklch page reports the same "n checked" as its hex twin, and a dark oklch background reads as dark', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-oklch-'));
    try {
      const a = runWithStdin(OKLCH, '--html', '--contrast', '-o', join(dir, 'a.png'));
      const b = runWithStdin(HEX, '--html', '--contrast', '-o', join(dir, 'b.png'));
      expect(a.status).toBe(0);
      expect(b.status).toBe(0);
      const aText = a.stdout + readFileSync(join(dir, 'a.meta.md'), 'utf-8');
      const bText = b.stdout + readFileSync(join(dir, 'b.meta.md'), 'utf-8');
      expect(checked(bText)).toBe(2);
      expect(checked(aText)).toBe(checked(bText));
      expect(a.stdout).toMatch(/bg: dark/);
      expect(b.stdout).toMatch(/bg: dark/);
      const light = runWithStdin(
        '<body style="margin:0;background:#fff;color:#000"><p>x</p></body>',
        '--html',
        '-o',
        join(dir, 'c.png'),
      );
      expect(light.stdout).toMatch(/bg: light/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--fail-on-aa catches an oklch pair that fails AA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-oklch-fail-'));
    try {
      const html =
        '<body style="margin:0;background:oklch(0.18 0.012 265);color:oklch(0.94 0.006 265)"><p>fine</p><p style="color:oklch(0.3 0 0)">dim</p></body>';
      const r = runWithStdin(
        html,
        '--html',
        '--contrast',
        '--fail-on-aa',
        '-o',
        join(dir, 'f.png'),
      );
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/contrast: (?:\d+ invisible, )?1 AA fail/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
