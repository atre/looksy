import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  navigateSafe,
  NETWORK_IDLE_TIMEOUT_MS,
  formatIdleTimeoutNote,
} from '../../src/navigate.js';

/** Playwright's real timeout errors have `.name === 'TimeoutError'` (playwright-core
 *  client/errors.js) — mimic that shape without pulling in a real browser. */
function timeoutError(ms: number): Error {
  const err = new Error(`page.goto: Timeout ${ms}ms exceeded.`);
  err.name = 'TimeoutError';
  return err;
}

function makeMockPage(gotoImpl: (opts: { waitUntil: string; timeout: number }) => Promise<any>) {
  const goto = vi.fn((_url: string, opts: { waitUntil: string; timeout: number }) =>
    gotoImpl(opts),
  );
  return { goto } as unknown as Page & { goto: ReturnType<typeof vi.fn> };
}

describe('NETWORK_IDLE_TIMEOUT_MS', () => {
  it('is 30 seconds', () => {
    expect(NETWORK_IDLE_TIMEOUT_MS).toBe(30000);
  });
});

describe('formatIdleTimeoutNote', () => {
  it('returns the exact note text', () => {
    expect(formatIdleTimeoutNote()).toBe('(timed out waiting for network idle)');
    expect(formatIdleTimeoutNote()).toContain('timed out waiting for network idle');
  });
});

describe('navigateSafe — networkidle cap', () => {
  it('caps the networkidle wait at NETWORK_IDLE_TIMEOUT_MS even when --timeout is much longer', async () => {
    const seenTimeouts: number[] = [];
    const fakeResponse = { status: () => 200 } as any;
    const page = makeMockPage(async (opts) => {
      seenTimeouts.push(opts.timeout);
      if (opts.waitUntil === 'networkidle') throw timeoutError(opts.timeout);
      return fakeResponse;
    });

    const result = await navigateSafe(page, 'https://example.com', { timeout: 120000 });

    // First (networkidle) call must never exceed the 30s cap, despite --timeout 120000.
    expect(seenTimeouts[0]).toBe(NETWORK_IDLE_TIMEOUT_MS);
    expect(result.idleTimedOut).toBe(true);
    expect(result.response).toBe(fakeResponse);
  });

  it('does not lower the idle wait below a shorter --timeout', async () => {
    const seenTimeouts: number[] = [];
    const page = makeMockPage(async (opts) => {
      seenTimeouts.push(opts.timeout);
      return { status: () => 200 } as any;
    });

    await navigateSafe(page, 'https://example.com', { timeout: 5000 });

    expect(seenTimeouts[0]).toBe(5000);
  });

  it('never blocks past the cap when the network never goes idle (third-party embeds)', async () => {
    const page = makeMockPage(async (opts) => {
      if (opts.waitUntil === 'networkidle') throw timeoutError(opts.timeout);
      return { status: () => 200 } as any;
    });

    const start = Date.now();
    const result = await navigateSafe(page, 'https://example.com', { timeout: 30000 });
    // Mock goto rejects synchronously (no real waiting), so this proves the *code path*
    // falls back deterministically rather than hanging — real timing is Playwright's own.
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.idleTimedOut).toBe(true);
  });

  it('reports idleTimedOut and appends the note to errors[] on a genuine idle timeout', async () => {
    const errors: string[] = [];
    const page = makeMockPage(async (opts) => {
      if (opts.waitUntil === 'networkidle') throw timeoutError(opts.timeout);
      return { status: () => 200 } as any;
    });

    const result = await navigateSafe(page, 'https://example.com', { timeout: 30000, errors });

    expect(result.idleTimedOut).toBe(true);
    expect(errors.some((e) => e.includes('timed out waiting for network idle'))).toBe(true);
  });

  it('does not set idleTimedOut for a non-timeout navigation failure that still falls back', async () => {
    const errors: string[] = [];
    const page = makeMockPage(async (opts) => {
      if (opts.waitUntil === 'networkidle') throw new Error('net::ERR_NAME_NOT_RESOLVED');
      return { status: () => 200 } as any;
    });

    const result = await navigateSafe(page, 'https://example.com', { timeout: 30000, errors });

    expect(result.idleTimedOut).toBeFalsy();
    expect(errors.some((e) => e.includes('timed out waiting for network idle'))).toBe(false);
    expect(errors.some((e) => e.includes('fell back to domcontentloaded'))).toBe(true);
  });

  it('resolves normally (no idleTimedOut) when networkidle succeeds outright', async () => {
    const fakeResponse = { status: () => 200 } as any;
    const page = makeMockPage(async () => fakeResponse);

    const result = await navigateSafe(page, 'https://example.com');

    expect(result.response).toBe(fakeResponse);
    expect(result.idleTimedOut).toBeUndefined();
  });
});
