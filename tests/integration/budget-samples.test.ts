import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');

function run(args: string[], input?: string) {
  return spawnSync('node', [BIN, ...args], {
    input,
    timeout: 60_000,
    encoding: 'utf-8',
  });
}

describe('--budget-samples validation', () => {
  it('errors when passed without --budget', () => {
    const result = run(['https://example.com', '--budget-samples', '3']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('looksy: --budget-samples requires --budget');
  });

  it('errors on --budget-samples 1 (below the n >= 2 floor)', () => {
    const result = run(['https://example.com', '--budget', 'FCP:1800', '--budget-samples', '1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('looksy: --budget-samples must be a whole number ≥ 2');
  });

  it('errors on a non-numeric --budget-samples value', () => {
    const result = run(['https://example.com', '--budget', 'FCP:1800', '--budget-samples', 'abc']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--budget-samples');
  });

  it('errors on a non-integer --budget-samples value', () => {
    const result = run(['https://example.com', '--budget', 'FCP:1800', '--budget-samples', '2.5']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--budget-samples');
  });
});

describe('--budget-samples sampling', () => {
  it('runs 3 navigations end-to-end and surfaces median-of-3 sampling in stdout + JSON sidecar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-budget-'));
    const output = join(dir, 'test-budget-samples.png');
    const metaJson = output.replace('.png', '.meta.json');

    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Budget Samples</title></head>' +
      '<body style="background:#fff;color:#000"><h1>hi</h1></body></html>';

    // FCP:60000 is absurdly generous — this proves 3 navigations happen and the report
    // shows sampling, not that any real perf numbers are meaningful.
    const result = run(
      ['--html', '--budget', 'FCP:60000', '--budget-samples', '3', '--json', '-o', output],
      html,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Samples:');
    expect(result.stdout).toMatch(/- FCP: min \d+ms \/ median \d+ms \/ max \d+ms \(n=3\)/);

    expect(existsSync(metaJson)).toBe(true);
    const sidecar = JSON.parse(readFileSync(metaJson, 'utf-8'));
    expect(sidecar.budget.sampleCount).toBe(3);
    expect(sidecar.budget.allPassed).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
