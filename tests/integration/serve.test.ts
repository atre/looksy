import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');

// Isolated from the default /tmp/looksy on purpose: this suite starts/stops a real
// --serve daemon, and the default dir may have a *real* one running for actual visual-QA
// work. Never touch that one.
const DIR = '/tmp/looksy-test-serve';

function run(args: string[], timeoutMs = 15_000) {
  return spawnSync('node', [BIN, ...args], {
    timeout: timeoutMs,
    encoding: 'utf-8',
    env: { ...process.env, LOOKSY_DIR: DIR },
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(fn: () => boolean, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

describe('--serve (detached by default)', () => {
  afterAll(() => {
    // Best-effort cleanup so a failed assertion never leaks a background Chromium process.
    const pidFile = `${DIR}/.server-pid`;
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      run(['--serve-stop']);
      if (!Number.isNaN(pid) && pidAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    rmSync(DIR, { recursive: true, force: true });
  });

  it("returns quickly (doesn't hang the caller) and the server outlives the CLI call", () => {
    rmSync(DIR, { recursive: true, force: true });
    const startedAt = Date.now();
    const result = run(['--serve']);
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe(0);
    // The actual bug: this used to block forever (a 300s hang in scripted/CI use).
    // Starting + publishing the WS endpoint should take low single-digit seconds.
    expect(elapsedMs).toBeLessThan(12_000);
    expect(result.stdout).toContain('server started (pid');
    expect(result.stdout).toContain('ws:');

    const pidFile = `${DIR}/.server-pid`;
    expect(existsSync(pidFile)).toBe(true);
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    expect(pidAlive(pid)).toBe(true);
  }, 15_000);

  it('is idempotent: a second --serve reports "already running" and exits 0', () => {
    const pidFile = `${DIR}/.server-pid`;
    const firstPid = readFileSync(pidFile, 'utf-8').trim();

    const startedAt = Date.now();
    const result = run(['--serve']);
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe(0);
    expect(elapsedMs).toBeLessThan(12_000);
    expect(result.stdout).toContain('already running');
    expect(result.stdout).toContain(firstPid);
  }, 15_000);

  it('--serve-stop kills the detached process', async () => {
    const pidFile = `${DIR}/.server-pid`;
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

    const result = run(['--serve-stop']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stopped');

    // The SIGTERM handler closes the browser before exiting — give it a moment.
    const gone = await waitUntil(() => !pidAlive(pid), 5000);
    expect(gone).toBe(true);
  }, 15_000);
});

describe('--serve --foreground', () => {
  it('blocks in the current process instead of detaching', async () => {
    const dir = '/tmp/looksy-test-serve-fg';
    rmSync(dir, { recursive: true, force: true });

    const child = spawn('node', [BIN, '--serve', '--foreground'], {
      env: { ...process.env, LOOKSY_DIR: dir },
    });

    let exited = false;
    child.on('exit', () => {
      exited = true;
    });

    await new Promise((r) => setTimeout(r, 3000));
    // Still running after 3s: this is the old blocking behavior, opted back into via
    // --foreground. Plain --serve (tested above) would already have returned by now.
    expect(exited).toBe(false);

    // Clean shutdown via the same SIGTERM handler --serve-stop relies on.
    child.kill('SIGTERM');
    await waitUntil(() => exited, 5000);
    expect(exited).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  }, 15_000);
});
