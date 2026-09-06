import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

// Acceptance tests for plans/2026-08-30-feedback-round.md — the CLI-level half.
// Unit half: tests/unit/feedback-round-2026-08-30-r2.test.ts.

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');

function run(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync('node', [BIN, ...args], { timeout: 60_000, encoding: 'utf-8', env });
}

function runWithStdin(input: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync('node', [BIN, ...args], { input, timeout: 60_000, encoding: 'utf-8', env });
}

// Same reason as host-resolver.test.ts: spawnSync would block the event loop that the
// in-process http server needs to answer the child.
function runAsync(
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [BIN, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}

function centerPixel(path: string): [number, number, number] {
  const png = PNG.sync.read(readFileSync(path));
  const i = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'looksy-r2-int-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('--help <section>', () => {
  it('--help batch prints only the batch section, exit 0', () => {
    const r = run(['--help', 'batch']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--pages-limit');
    expect(r.stdout).not.toContain('--cdp');
  });
  it('--help nope lists the sections on stderr, exit 1', () => {
    const r = run(['--help', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown help section "nope"');
  });
  it('--help alone still prints the full text, with the Sections: line second', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')[1]).toMatch(/^Sections: /);
    expect(r.stdout).toContain('--cdp');
  });
});

describe('--save-storage-state round trip', () => {
  let server: Server;
  let origin = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      if (req.url === '/set') {
        res.end(
          '<!doctype html><html lang="en"><head><title>set</title></head><body><script>localStorage.setItem("looksy_ss","yes")</script><p>set</p></body></html>',
        );
      } else {
        res.end(
          '<!doctype html><html lang="en"><head><title>read</title></head><body><p id="v"></p><script>document.getElementById("v").textContent = localStorage.getItem("looksy_ss") || "none"</script></body></html>',
        );
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('writes the context storage state, and --storage-state replays it', async () => {
    const state = join(dir, 'ss.json');
    const a = await runAsync([
      `${origin}/set`,
      '--save-storage-state',
      state,
      '-o',
      join(dir, 'a.png'),
    ]);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain(`storage state: ${state}`);
    expect(existsSync(state)).toBe(true);
    const json = JSON.parse(readFileSync(state, 'utf-8'));
    const entries = (json.origins ?? []).flatMap((o: any) => o.localStorage ?? []);
    expect(entries).toContainEqual({ name: 'looksy_ss', value: 'yes' });

    const b = await runAsync([
      `${origin}/read`,
      '--storage-state',
      state,
      '--check',
      'text:yes',
      '-o',
      join(dir, 'b.png'),
    ]);
    expect(b.status).toBe(0);
    expect(b.stdout).toContain('[PASS] text:yes');
  }, 60_000);
});

describe('scrollY readout', () => {
  const H =
    '<!doctype html><html><head><style>body{margin:0;height:3000px;background:linear-gradient(#fff 0 1500px,#000 1500px)}</style></head><body></body></html>';

  it('--fold after --interact scroll:2000 captures the offset and says so on the Page line', () => {
    const out = join(dir, 'scrolled.png');
    const r = runWithStdin(H, [
      '--html',
      '--fold',
      '--interact',
      'scroll:2000,wait:200',
      '-o',
      out,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Page: 1280x3000px · scheme: light · bg: light · scrollY: 2000px/m);
    expect(centerPixel(out)).toEqual([0, 0, 0]);
  }, 30_000);

  it('a top-of-page capture has no scrollY suffix', () => {
    const out = join(dir, 'top.png');
    const r = runWithStdin(H, ['--html', '--fold', '-o', out]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('scrollY');
    expect(centerPixel(out)).toEqual([255, 255, 255]);
  }, 30_000);
});

describe('default-path overwrite note', () => {
  it('prints the note on the second capture to the default path, not the first', () => {
    const looksyDir = join(dir, 'looksy-home');
    const env = { ...process.env, LOOKSY_DIR: looksyDir };
    const first = runWithStdin('<h1>one</h1>', ['--html'], env);
    expect(first.status).toBe(0);
    expect(first.stdout).not.toContain('note: replaced previous default capture');
    const second = runWithStdin('<h1>two</h1>', ['--html'], env);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(
      /^note: replaced previous default capture \(written \d{2}:\d{2}:\d{2}, \d+s ago\)$/m,
    );
    const explicit = runWithStdin(
      '<h1>three</h1>',
      ['--html', '-o', join(dir, 'explicit.png')],
      env,
    );
    expect(explicit.stdout).not.toContain('note: replaced');
  }, 60_000);
});
