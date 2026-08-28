import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Page } from 'playwright';
import { stabilizePage, isLooksyCspError, tagLooksyConsoleError } from '../../src/navigate.js';

/**
 * stabilizePage() only talks to a Playwright Page (evaluate/addStyleTag), so it's
 * unit-testable against a mock page without a real browser — no navigation, no
 * network, just call order and arguments.
 */
function makeMockPage(evaluateImpl?: (fn: unknown) => Promise<unknown>) {
  const page = {
    evaluate: vi.fn(evaluateImpl ?? (async () => undefined)),
    addStyleTag: vi.fn(async () => ({}) as any),
  };
  return page as unknown as Page & {
    evaluate: ReturnType<typeof vi.fn>;
    addStyleTag: ReturnType<typeof vi.fn>;
  };
}

describe('stabilizePage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for fonts, then injects a pause/freeze style tag, then waits one rAF — in that order', async () => {
    const calls: string[] = [];
    const page = makeMockPage(async () => {
      calls.push('evaluate');
      return undefined;
    });
    page.addStyleTag.mockImplementation(async () => {
      calls.push('addStyleTag');
      return {} as any;
    });

    await stabilizePage(page);

    expect(calls).toEqual(['evaluate', 'addStyleTag', 'evaluate']);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.addStyleTag).toHaveBeenCalledTimes(1);
  });

  it('injects a style tag that pauses animations and zeroes transitions/caret on every element', async () => {
    const page = makeMockPage();
    await stabilizePage(page);

    expect(page.addStyleTag).toHaveBeenCalledTimes(1);
    const { content } = page.addStyleTag.mock.calls[0][0] as { content: string };
    expect(content).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after/);
    expect(content).toContain('animation-play-state: paused !important');
    expect(content).toContain('transition-duration: 0s !important');
    expect(content).toContain('transition-delay: 0s !important');
    expect(content).toContain('caret-color: transparent !important');
  });

  it('caps the fonts.ready wait at 3s so a font that never fires cannot hang the capture', async () => {
    vi.useFakeTimers();

    // First evaluate() call is the fonts.ready wait — never resolves, simulating a
    // stuck/blocked font load. Second is the trailing rAF wait.
    const page = makeMockPage();
    page.evaluate
      .mockImplementationOnce(() => new Promise(() => {})) // fonts.ready: hangs forever
      .mockImplementationOnce(async () => undefined); // rAF wait

    let settled = false;
    const done = stabilizePage(page).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    expect(page.addStyleTag).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(settled).toBe(true);
    expect(page.addStyleTag).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately once fonts settle before the 3s cap', async () => {
    const page = makeMockPage(async () => undefined);
    const start = Date.now();
    await stabilizePage(page);
    // No fake timers here — a fast-resolving evaluate() must not wait out the cap.
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('isLooksyCspError', () => {
  it('matches a CSP inline-style violation message', () => {
    expect(
      isLooksyCspError(
        `Refused to apply inline style because it violates the following Content Security Policy directive: "style-src 'self' 'nonce-abc'"…`,
      ),
    ).toBe(true);
  });

  it('does not match an unrelated console error', () => {
    expect(isLooksyCspError('Uncaught TypeError: x is not a function')).toBe(false);
  });
});

describe('tagLooksyConsoleError', () => {
  const csp = `Refused to apply inline style because it violates the following Content Security Policy directive: "style-src 'self'"`;

  it('tags looksy-caused CSP errors with a ` (looksy)` suffix', () => {
    expect(tagLooksyConsoleError(csp, true)).toBe(`${csp} (looksy)`);
  });

  it('leaves errors alone when looksy injected no style, or when they are unrelated', () => {
    expect(tagLooksyConsoleError(csp, false)).toBe(csp);
    expect(tagLooksyConsoleError('Uncaught TypeError: x is not a function', true)).toBe(
      'Uncaught TypeError: x is not a function',
    );
  });
});
