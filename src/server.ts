import { chromium, type Browser } from 'playwright';
import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOOKSY_DIR } from './utils.js';
import { parseHostResolverRule } from './cli-utils.js';

const SERVER_DIR = LOOKSY_DIR;
const WS_FILE = `${SERVER_DIR}/.server-ws`;
const PID_FILE = `${SERVER_DIR}/.server-pid`;
const LOG_FILE = `${SERVER_DIR}/.server-log`;
const DETACH_TIMEOUT_MS = 10_000;

/**
 * Start a persistent Chromium server.
 *
 * Detaches by default: a background process does the actual `chromium.launchServer`
 * work and this call returns as soon as that process has published its WS endpoint (or
 * failed to). Previously this blocked the caller forever (`await new Promise(() => {})`
 * ran in the same process), which hangs any scripted/CI invocation that doesn't
 * background it manually — pass `{ foreground: true }` (CLI: `--serve --foreground`) for
 * that old blocking behavior, e.g. if you want to supervise it yourself under
 * systemd/pm2/`&`.
 */
export async function startServer(opts?: { foreground?: boolean }): Promise<void> {
  if (!existsSync(SERVER_DIR)) mkdirSync(SERVER_DIR, { recursive: true, mode: 0o700 });

  // Idempotency: if a server is already running — verified with a live connect, not just
  // file presence — report it and return (exit 0) immediately, regardless of --foreground.
  const runningPid = await checkRunning();
  if (runningPid) {
    console.log(`looksy: server already running (pid ${runningPid})`);
    return;
  }

  if (!opts?.foreground) {
    await startServerDetached();
    return;
  }

  let server;
  try {
    server = await chromium.launchServer({ headless: true });
  } catch (err: any) {
    if (err.message?.includes("Executable doesn't exist")) {
      throw new Error('Chromium not found. Run: npx playwright install chromium');
    }
    throw err;
  }
  const wsEndpoint = server.wsEndpoint();

  writeFileSync(WS_FILE, wsEndpoint, 'utf-8');
  writeFileSync(PID_FILE, String(process.pid), 'utf-8');

  console.log(`looksy: server started (pid ${process.pid})`);
  console.log(`  ws: ${wsEndpoint}`);

  process.on('SIGTERM', () => {
    server.close();
    cleanup();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    server.close();
    cleanup();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

/**
 * Re-exec `--serve --foreground` as a detached background process (new session, stdio
 * redirected to a log file) and wait for it to publish its WS endpoint before returning
 * — or surface why it didn't. This is what makes plain `--serve` safe to call from
 * scripts: the parent process exits as soon as the child is confirmed up, instead of
 * holding the terminal/pipe open for the lifetime of the browser.
 */
async function startServerDetached(): Promise<void> {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const logFd = openSync(LOG_FILE, 'a');

  let child;
  try {
    child = spawn(process.execPath, [cliPath, '--serve', '--foreground'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  child.unref();

  const deadline = Date.now() + DETACH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(WS_FILE) && existsSync(PID_FILE)) {
      const ws = readFileSync(WS_FILE, 'utf-8').trim();
      const pid = readFileSync(PID_FILE, 'utf-8').trim();
      console.log(`looksy: server started (pid ${pid})`);
      console.log(`  ws: ${ws}`);
      return;
    }
    // The child already exited (e.g. Chromium missing) — stop waiting out the full
    // timeout and go straight to reporting why.
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  let detail = '';
  try {
    detail = readFileSync(LOG_FILE, 'utf-8').trim().split('\n').slice(-5).join('\n');
  } catch {
    /* no log yet */
  }
  throw new Error(
    detail
      ? `server failed to start:\n${detail}`
      : 'server failed to start (timed out waiting for it to come up)',
  );
}

/**
 * Verify a running server by connecting to its published WS endpoint.
 * Returns its pid if alive; cleans up stale pointer files and returns null otherwise.
 */
async function checkRunning(): Promise<string | null> {
  if (!existsSync(WS_FILE)) return null;
  try {
    const ws = readFileSync(WS_FILE, 'utf-8').trim();
    const testBrowser = await chromium.connect(ws, { timeout: 10_000 });
    await testBrowser.close();
    try {
      return readFileSync(PID_FILE, 'utf-8').trim();
    } catch {
      return 'unknown';
    }
  } catch {
    cleanup();
    return null;
  }
}

/**
 * Stop a running persistent Chromium server.
 */
export function stopServer(): void {
  if (!existsSync(PID_FILE)) {
    console.log('looksy: no server running');
    return;
  }
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`looksy: server stopped (pid ${pid})`);
  } catch {
    console.log(`looksy: server process ${pid} not found (stale pid file)`);
  }
  cleanup();
}

/**
 * Connect to a running server or launch a new browser.
 * Returns { browser, owned } — always close when done (close() disconnects without killing the server).
 *
 * `hostResolverRule` ("domain:ip") always forces a fresh, dedicated launch: Chromium only
 * honors --host-resolver-rules at process start, so it can't be applied to an already-running
 * --serve session or a reused connection — those would silently keep using the OS resolver.
 */
/**
 * Set once at CLI startup from --cdp. When set, every connectOrLaunch attaches
 * to that browser over CDP (e.g. a Playwright MCP session or any Chromium
 * started with --remote-debugging-port) instead of launching or using --serve.
 * Auth/cookies/storage of the attached browser profile carry over.
 */
let cdpEndpointOverride: string | undefined;
export function setCdpEndpoint(endpoint: string | undefined): void {
  cdpEndpointOverride = endpoint;
}

export async function connectOrLaunch(opts?: {
  hostResolverRule?: string;
}): Promise<{ browser: Browser; owned: boolean }> {
  if (cdpEndpointOverride) {
    if (opts?.hostResolverRule) {
      throw new Error(
        '--cdp and --host-resolver cannot be combined: host resolver rules only apply to a browser looksy launches itself.',
      );
    }
    try {
      // owned:true is safe — close() on a CDP-connected browser only detaches;
      // the external browser process keeps running.
      const browser = await chromium.connectOverCDP(cdpEndpointOverride, { timeout: 10000 });
      return { browser, owned: true };
    } catch (err: any) {
      throw new Error(
        `Could not connect over CDP to ${cdpEndpointOverride}: ${err.message}. Is the browser running with --remote-debugging-port (or a ws:// CDP endpoint)?`,
      );
    }
  }

  if (opts?.hostResolverRule) {
    const { domain, ip } = parseHostResolverRule(opts.hostResolverRule);
    try {
      const browser = await chromium.launch({
        headless: true,
        args: [`--host-resolver-rules=MAP ${domain} ${ip}`],
      });
      return { browser, owned: true };
    } catch (err: any) {
      if (err.message?.includes("Executable doesn't exist")) {
        throw new Error('Chromium not found. Run: npx playwright install chromium');
      }
      throw err;
    }
  }

  if (existsSync(WS_FILE)) {
    const ws = readFileSync(WS_FILE, 'utf-8').trim();
    // Retry transient connect failures (server briefly busy under concurrency) before
    // giving up. Only clean up the WS pointer once the server is genuinely unreachable —
    // deleting it on a transient error would force every later invocation to cold-launch
    // its own browser, silently defeating --serve.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Explicit timeout: chromium.connect defaults to 0 (wait forever), which
        // turns an unresponsive server into an infinite hang instead of a fallback.
        const browser = await chromium.connect(ws, { timeout: 10_000 });
        return { browser, owned: false };
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 150 * attempt));
          continue;
        }
        // Server appears dead — remove the stale pointer and fall through to launch.
        cleanup();
      }
    }
  }
  try {
    const browser = await chromium.launch({ headless: true });
    return { browser, owned: true };
  } catch (err: any) {
    if (err.message?.includes("Executable doesn't exist")) {
      throw new Error('Chromium not found. Run: npx playwright install chromium');
    }
    throw err;
  }
}

/**
 * Run `fn` with a browser from connectOrLaunch() and ALWAYS release it afterwards.
 *
 * Every hang in the "command finished but never exited" family (save, standalone
 * --responsive-check, compare --class-audit) came from `if (owned) browser.close()`:
 * on a --serve connection close() only disconnects, so skipping it for "not owned"
 * left the websocket open and Node alive. Route one-off browser work through here
 * instead of hand-writing the try/finally.
 */
export async function withBrowser<T>(
  fn: (browser: Browser, info: { owned: boolean }) => Promise<T>,
  opts?: { hostResolverRule?: string },
): Promise<T> {
  const { browser, owned } = await connectOrLaunch(opts);
  try {
    return await fn(browser, { owned });
  } finally {
    await browser.close().catch(() => {});
  }
}

function cleanup(): void {
  try {
    if (existsSync(WS_FILE)) unlinkSync(WS_FILE);
  } catch {}
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
}
