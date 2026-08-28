import { describe, it, expect } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');

function run(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync('node', [BIN, ...args], {
    timeout: 30_000,
    encoding: 'utf-8',
    env: env ?? process.env,
  });
}

/**
 * Async counterpart to `run`. Required whenever the test also runs an in-process HTTP
 * server the child needs to call back into: `spawnSync` blocks this thread's event loop
 * until the child exits, so a same-process `http.Server` can never answer the child's
 * request — the child hangs until its own navigation timeout. `spawn` doesn't block, so
 * the server keeps serving while we await the child.
 */
function runAsync(
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('node', [BIN, ...args], { env: env ?? process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}

describe('--host-resolver validation', () => {
  it('rejects a value with no domain:ip colon', () => {
    const result = run(['https://example.com', '--host-resolver', 'not-a-valid-rule']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--host-resolver must be in the form domain:ip');
  });

  it('rejects an empty domain side', () => {
    const result = run(['https://example.com', '--host-resolver', ':127.0.0.1']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--host-resolver must be in the form domain:ip');
  });

  it('rejects an empty ip side', () => {
    const result = run(['https://example.com', '--host-resolver', 'example.com:']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--host-resolver must be in the form domain:ip');
  });
});

describe('--host-resolver functional', () => {
  it('maps a fake hostname to a local server, bypassing the OS resolver entirely', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<title>Host Resolver Test</title><h1 style="color:#000;background:#fff">It works</h1>',
      );
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const port = (server.address() as AddressInfo).port;

    // .invalid is reserved (RFC 2606) — guaranteed to never resolve on the real internet,
    // so a successful capture here can only mean --host-resolver-rules did the mapping.
    const fakeHost = 'looksy-host-resolver-test.invalid';
    const dir = '/tmp/looksy/test-host-resolver';
    rmSync(dir, { recursive: true, force: true });

    let result;
    try {
      result = await runAsync(
        [`http://${fakeHost}:${port}/`, '--host-resolver', `${fakeHost}:127.0.0.1`, '--report'],
        { ...process.env, LOOKSY_DIR: dir },
      );
    } finally {
      server.close();
    }

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Host Resolver Test');
    rmSync(dir, { recursive: true, force: true });
  }, 20_000);
});
