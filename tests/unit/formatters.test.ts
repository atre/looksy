import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatNetwork, type NetworkData } from '../../src/network.js';
import { formatLinks, type LinkResult } from '../../src/links.js';
import { formatCssVars } from '../../src/css-vars.js';
import { formatA11y, type A11yData } from '../../src/a11y.js';
import { formatLighthouse, type LighthouseData } from '../../src/lighthouse.js';
import {
  printResult,
  formatBrief,
  briefIsRed,
  aaFailFragment,
  invisibleFragment,
} from '../../src/cli-output.js';
import type { ScreenshotResult } from '../../src/screenshot.js';

describe('formatNetwork', () => {
  const net = (over: Partial<NetworkData> = {}): NetworkData => ({
    resources: [],
    totalSize: 0,
    totalDuration: 0,
    slowCount: 0,
    ...over,
  });

  it('handles no resources', () => {
    expect(formatNetwork(net())).toBe('## Network: No resources loaded\n');
  });

  it('compact, no slow resources', () => {
    const data = net({
      resources: [
        {
          name: 'a.js',
          type: 'script',
          duration: 100,
          transferSize: 2048,
          startTime: 0,
          decodedSize: 4096,
        },
      ],
      totalSize: 2048,
      totalDuration: 120,
    });
    const out = formatNetwork(data, { compact: true });
    expect(out).toContain('1 resources');
    expect(out).toContain('no slow resources');
  });

  it('compact flags slow resources (>500ms)', () => {
    const data = net({
      resources: [
        {
          name: 'slow.js',
          type: 'script',
          duration: 900,
          transferSize: 1024,
          startTime: 0,
          decodedSize: 1024,
        },
      ],
      totalSize: 1024,
      totalDuration: 900,
    });
    const out = formatNetwork(data, { compact: true });
    expect(out).toContain('1 slow');
    expect(out).toContain('slow.js');
  });
});

describe('formatLinks', () => {
  const ok = (url: string): LinkResult => ({
    url,
    text: url,
    status: 200,
    ok: true,
    verdict: 'ok',
  });
  const broken = (url: string, status: number | null = 404): LinkResult => ({
    url,
    text: url,
    status,
    ok: false,
    verdict: 'broken',
  });
  const unverifiable = (url: string, status: number | null = 403): LinkResult => ({
    url,
    text: url,
    status,
    ok: false,
    verdict: 'unverifiable',
  });

  it('compact, all OK', () => {
    expect(formatLinks([ok('https://a.com')], { compact: true })).toBe(
      '## Links: 1 checked, all OK\n',
    );
  });

  it('compact lists broken links', () => {
    const out = formatLinks([ok('https://a.com'), broken('https://b.com/x')], { compact: true });
    expect(out).toContain('## Links: 1/2 broken');
    expect(out).toContain('https://b.com/x');
  });

  it('full mode renders a broken-links table', () => {
    const out = formatLinks([broken('https://b.com', 500)]);
    expect(out).toContain('### Broken Links');
    expect(out).toContain('500');
  });

  it('lists unverifiable links separately, never as broken', () => {
    const out = formatLinks([ok('https://a.com'), unverifiable('https://linkedin.com/x', 999)]);
    expect(out).toContain('### Unverifiable (1)');
    expect(out).toContain('https://linkedin.com/x');
    expect(out).not.toContain('### Broken Links');
  });

  it('compact mode lists unverifiable links separately', () => {
    const out = formatLinks([unverifiable('https://linkedin.com/x', 999)], { compact: true });
    expect(out).toContain('## Links: 0/1 broken');
    expect(out).toContain('Unverifiable (1)');
  });
});

describe('formatCssVars', () => {
  it('handles none found', () => {
    expect(formatCssVars([])).toBe('## CSS Vars: none found\n');
  });
  it('compact joins name=value pairs', () => {
    const out = formatCssVars(
      [
        { name: '--c', value: '#fff' },
        { name: '--g', value: '8px' },
      ],
      { compact: true },
    );
    expect(out).toBe('## CSS Vars (2): --c=#fff | --g=8px\n');
  });
});

describe('formatA11y', () => {
  const data = (over: Partial<A11yData> = {}): A11yData => ({
    landmarks: [],
    headings: [],
    interactiveCount: { links: 0, buttons: 0, inputs: 0, forms: 0 },
    issues: [],
    ...over,
  });

  it('compact, no issues', () => {
    expect(formatA11y(data(), { compact: true })).toBe('## A11y: No issues\n');
  });

  it('compact lists issues + landmarks', () => {
    const out = formatA11y(
      data({
        issues: ['Missing lang attribute on <html>'],
        landmarks: [{ role: 'main', tag: 'main', childCount: 3 }],
      }),
      { compact: true },
    );
    expect(out).toContain('## A11y: 1 issue(s)');
    expect(out).toContain('Missing lang');
    expect(out).toContain('main');
  });
});

describe('formatLighthouse', () => {
  const data = (over: Partial<LighthouseData> = {}): LighthouseData => ({
    resourceBreakdown: [],
    longTasks: 0,
    ...over,
  });

  it('compact summary includes long tasks', () => {
    const out = formatLighthouse(data({ longTasks: 2, estimatedINP: 120 }), { compact: true });
    expect(out).toContain('## Lighthouse:');
    expect(out).toContain('2 long tasks');
    expect(out).toContain('INP≈120ms');
  });

  it('full mode renders the heading', () => {
    expect(formatLighthouse(data({ longTasks: 0 }))).toContain('## Extended Performance');
  });
});

describe('printResult consent line', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints "consent: not shown" under quiet, and nothing else', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = {
      imagePath: '/x.png',
      consentDismissed: { action: 'none' },
    };
    printResult(result, { quiet: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('consent: not shown');
  });

  it('prints "consent: clicked <target>" under quiet, and nothing else', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = {
      imagePath: '/x.png',
      consentDismissed: { action: 'clicked', target: '#accept' },
    };
    printResult(result, { quiet: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('consent: clicked #accept');
  });

  it('prints "consent: hidden <target>"', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = {
      imagePath: '/x.png',
      consentDismissed: { action: 'hidden', target: '2 container(s)' },
    };
    printResult(result, { quiet: true });
    expect(log).toHaveBeenCalledWith('consent: hidden 2 container(s)');
  });
});

describe('printResult networkIdleTimeout note', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the idle-timeout note when navigation hit the networkidle cap', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = { imagePath: '/x.png', networkIdleTimeout: true };
    printResult(result, { quiet: true });
    expect(log).toHaveBeenCalledWith('(timed out waiting for network idle)');
  });

  it('prints nothing extra when navigation did not hit the cap', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = { imagePath: '/x.png' };
    printResult(result, { quiet: true });
    expect(log).not.toHaveBeenCalledWith('(timed out waiting for network idle)');
  });
});

describe('printResult --serve tip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the Tip on a slow owned-browser launch, but not under -q', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result: ScreenshotResult = { imagePath: '/x.png', ownedBrowser: true, elapsedMs: 2500 };
    printResult(result, { quiet: true });
    expect(err).not.toHaveBeenCalled();
    printResult(result, {});
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^Tip: looksy --serve/));
  });
});

describe('printResult -q + --check: checks only', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints Page/consent/check lines and suppresses report/suggest/audit/responsive/summaries', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = {
      imagePath: '/x.png',
      pageInfo: { width: 375, height: 900, title: 'T' },
      consentDismissed: { action: 'none' },
      reportText: '## Report body',
      checkResults: '[PASS] no-hscroll',
      responsiveCheckText: 'responsive: 375px ok',
      auditResults: '## Audit',
      analysisSummaries: ['a11y: 0 issues'],
      suggestText: '1. [LOW] x',
    };
    printResult(result, { quiet: true });
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines).toContain('Page: 375x900px "T"');
    expect(lines).toContain('consent: not shown');
    expect(lines).toContain('[PASS] no-hscroll');
    expect(lines.join('\n')).not.toContain('Report body');
    expect(lines.join('\n')).not.toContain('[LOW]');
    expect(lines.join('\n')).not.toContain('responsive:');
    expect(lines.join('\n')).not.toContain('## Audit');
    expect(lines.join('\n')).not.toContain('a11y: 0 issues');
  });

  it('without --check, quiet still prints analyzer summaries/report/suggest as before', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ScreenshotResult = {
      imagePath: '/x.png',
      reportText: '## Report body',
      analysisSummaries: ['a11y: 0 issues'],
      suggestText: '1. [LOW] x',
    };
    printResult(result, { quiet: true });
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines).toContain('## Report body');
    expect(lines).toContain('a11y: 0 issues');
    expect(lines).toContain('1. [LOW] x');
  });
});

describe('briefIsRed', () => {
  it('is true for HTTP >= 400, hscroll, AA fail, check fail or error; false when clean', () => {
    const clean = {
      imagePath: 'x',
      pageInfo: { width: 375, height: 1, title: '', viewportWidth: 375 },
    };
    expect(briefIsRed([{ url: 'u', result: clean }])).toBe(false);
    expect(briefIsRed([{ url: 'u', result: { ...clean, httpStatus: 404 } }])).toBe(true);
    expect(briefIsRed([{ url: 'u', result: { ...clean, error: 'boom' } }])).toBe(true);
    expect(
      briefIsRed([{ url: 'u', result: { ...clean, contrastFailures: { aa: 1, aaa: 0 } } }]),
    ).toBe(true);
    expect(
      briefIsRed([
        { url: 'u', result: clean },
        { url: 'v', result: { ...clean, httpStatus: 500 } },
      ]),
    ).toBe(true);
  });
});

describe('formatBrief', () => {
  it('prints only red URLs, hscroll + AA fail fragments', () => {
    const out = formatBrief([
      {
        url: 'https://a.com/',
        result: {
          imagePath: 'x',
          pageInfo: { width: 396, height: 1, title: '', viewportWidth: 375 },
          contrastFailures: { aa: 2, aaa: 9 },
        },
      },
      {
        url: 'https://b.com/',
        result: {
          imagePath: 'y',
          pageInfo: { width: 375, height: 1, title: '', viewportWidth: 375 },
          contrastFailures: { aa: 0, aaa: 3 },
        },
      },
    ]);
    expect(out).toEqual(['✗ https://a.com/ — hscroll +21px, 2 AA fail']);
  });

  it('all clean → single ✓ summary line', () => {
    const out = formatBrief([
      { url: 'https://a.com/', result: { imagePath: 'x' } },
      { url: 'https://b.com/', result: { imagePath: 'y' } },
    ]);
    expect(out).toEqual(['✓ 2 URLs clean']);
  });

  it('single clean URL → singular "1 URL clean"', () => {
    const out = formatBrief([{ url: 'https://a.com/', result: { imagePath: 'x' } }]);
    expect(out).toEqual(['✓ 1 URL clean']);
  });

  it('HTTP error status folds into the ✗ line as the first fragment', () => {
    const out = formatBrief([
      { url: 'https://a.com/', result: { imagePath: 'x', httpStatus: 404 } },
      {
        url: 'https://b.com/',
        result: { imagePath: 'y', httpStatus: 500, contrastFailures: { aa: 2, aaa: 0 } },
      },
      { url: 'https://c.com/', result: { imagePath: 'z', httpStatus: 200 } },
    ]);
    expect(out).toEqual(['✗ https://a.com/ — HTTP 404', '✗ https://b.com/ — HTTP 500, 2 AA fail']);
  });

  it('caps at 10 lines with a trailing "and N more"', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      url: `https://a${i}.com/`,
      result: { imagePath: 'x', contrastFailures: { aa: 1, aaa: 0 } },
    }));
    const out = formatBrief(entries);
    expect(out).toHaveLength(10);
    expect(out[9]).toMatch(/… and 21 more/);
  });

  it('a failed --check assertion counts as red', () => {
    const out = formatBrief([
      {
        url: 'https://a.com/',
        result: {
          imagePath: 'x',
          checkResultsData: [{ assertion: 'no-hscroll', pass: false, detail: 'd' }],
        },
      },
    ]);
    expect(out).toEqual(['✗ https://a.com/ — 1 check fail']);
  });

  it('an outright batch-capture failure counts as red', () => {
    const out = formatBrief([
      { url: 'https://a.com/', result: { imagePath: '', error: 'net::ERR_TIMED_OUT' } },
    ]);
    expect(out).toEqual(['✗ https://a.com/ — net::ERR_TIMED_OUT']);
  });

  it('invisible contrast is counted separately from AA fail and leads the fragment list', () => {
    const out = formatBrief([
      {
        url: 'https://a.com/',
        result: { imagePath: 'x', contrastFailures: { aa: 1, aaa: 1, invisible: 1 } },
      },
    ]);
    expect(out).toEqual(['✗ https://a.com/ — 1 invisible, 1 AA fail']);
  });
});

describe('invisibleFragment', () => {
  it('returns "N invisible" when invisible > 0, undefined otherwise', () => {
    expect(invisibleFragment({ contrastFailures: { aa: 1, aaa: 1, invisible: 1 } })).toBe(
      '1 invisible',
    );
    expect(
      invisibleFragment({ contrastFailures: { aa: 1, aaa: 1, invisible: 0 } }),
    ).toBeUndefined();
    expect(invisibleFragment({ contrastFailures: { aa: 1, aaa: 1 } })).toBeUndefined();
    expect(invisibleFragment({})).toBeUndefined();
  });

  it('is a distinct fragment from aaFailFragment (not additive)', () => {
    const result = { contrastFailures: { aa: 1, aaa: 1, invisible: 1 } };
    expect(invisibleFragment(result)).toBe('1 invisible');
    expect(aaFailFragment(result)).toBe('1 AA fail');
  });
});
