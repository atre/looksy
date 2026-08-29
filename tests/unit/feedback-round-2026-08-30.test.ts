import { describe, it, expect } from 'vitest';
import * as utils from '../../src/utils.js';
import * as cliUtils from '../../src/cli-utils.js';
import * as diffMod from '../../src/diff.js';
import * as check from '../../src/check.js';
import { buildSuggestInput } from '../../src/screenshot-suggest.js';
// New module in this round — dynamic import so a missing file fails its own tests, not the file.
const failed: Record<string, any> = await import('../../src/failed-requests.js').catch(() => ({}));
import { formatMetadata, type PageMetadata } from '../../src/metadata.js';
import { summarize } from '../../src/analysis-summary.js';

// Acceptance tests for plans/2026-08-30-p5-field-feedback.md (PLAN.md ## P5, field
// feedback 2026-08-19..21 from a storefront + lander fleet). Namespace imports so each
// missing export fails its own test ("… is not a function") instead of the whole file.
const u = utils as any;
const cu = cliUtils as any;
const d = diffMod as any;
const ck = check as any;
const fr = failed as any;

function img(over: Partial<PageMetadata['images'][number]> = {}): PageMetadata['images'][number] {
  return {
    src: 'https://shop.example/img/0.jpg',
    alt: '',
    hasAlt: true,
    broken: true,
    naturalWidth: 0,
    naturalHeight: 0,
    displayWidth: 100,
    displayHeight: 100,
    format: 'jpg',
    ...over,
  };
}

function meta(images: PageMetadata['images']): PageMetadata {
  return {
    title: 'T',
    viewport: { width: 1280, height: 800 },
    fonts: [],
    consoleErrors: [],
    images,
    links: [],
    elements: [],
  } as unknown as PageMetadata;
}

// 1. default LOOKSY_DIR → ~/.looksy (was /tmp/looksy, wiped on reboot)
describe('LOOKSY_DIR default', () => {
  it('resolves to <home>/.looksy when the env var is unset', () => {
    expect(u.defaultLooksyDir({}, '/Users/x')).toBe('/Users/x/.looksy');
  });
  it('honors LOOKSY_DIR when set', () => {
    expect(u.defaultLooksyDir({ LOOKSY_DIR: '/ci/baselines' }, '/Users/x')).toBe('/ci/baselines');
  });
  it('hints about legacy /tmp/looksy baselines only when they exist and the new dir has none', () => {
    const hint = u.legacyBaselinesHint({ envSet: false, legacyHasBaselines: true, currentHasBaselines: false });
    expect(hint).toContain('baselines found in /tmp/looksy');
    expect(hint).toContain('~/.looksy');
    expect(u.legacyBaselinesHint({ envSet: false, legacyHasBaselines: true, currentHasBaselines: true })).toBeUndefined();
    expect(u.legacyBaselinesHint({ envSet: true, legacyHasBaselines: true, currentHasBaselines: false })).toBeUndefined();
    expect(u.legacyBaselinesHint({ envSet: false, legacyHasBaselines: false, currentHasBaselines: false })).toBeUndefined();
  });
});

// 3. --viewport WxH alias
describe('--viewport WxH', () => {
  it('parses "390x844" into width/height', () => {
    expect(cu.parseViewport('390x844')).toEqual({ width: 390, height: 844 });
  });
  it('rejects malformed values', () => {
    expect(() => cu.parseViewport('390')).toThrow(/--viewport must be "<width>x<height>"/);
    expect(() => cu.parseViewport('0x844')).toThrow(/--viewport/);
  });
  it('resolveViewport uses --viewport when given', () => {
    expect(cliUtils.resolveViewport({ viewport: '390x844' })).toEqual({ width: 390, height: 844 });
  });
  it('resolveViewport refuses --viewport combined with --width/--height/--mobile/--tablet', () => {
    for (const extra of [{ width: '400' }, { height: '900' }, { mobile: true }, { tablet: true }]) {
      expect(() => cliUtils.resolveViewport({ viewport: '390x844', ...extra })).toThrow(
        /--viewport cannot be combined with --width\/--height\/--mobile\/--tablet/,
      );
    }
  });
});

// 4. diff shows baseline age
describe('formatBaselineAge', () => {
  it('prints the local save time and whole days since', () => {
    const saved = new Date(2026, 7, 20, 14, 3); // local time
    const now = new Date(2026, 7, 30, 10, 0);
    expect(d.formatBaselineAge(saved, now)).toBe('baseline saved 2026-08-20 14:03 (9d ago)');
  });
  it('uses hours under one day', () => {
    const saved = new Date(2026, 7, 30, 8, 0);
    const now = new Date(2026, 7, 30, 10, 30);
    expect(d.formatBaselineAge(saved, now)).toBe('baseline saved 2026-08-30 08:00 (2h ago)');
  });
});

// 5. diff <url> <name> honors -o
describe('diffOutputPaths', () => {
  it('defaults to <LOOKSY_DIR>/preview.png + <LOOKSY_DIR>/diff.png', () => {
    expect(cu.diffOutputPaths(undefined, '/base')).toEqual({ capture: '/base/preview.png', diff: '/base/diff.png' });
  });
  it('-o names the capture; the diff image gets a -diff suffix beside it', () => {
    expect(cu.diffOutputPaths('/x/prod.png', '/base')).toEqual({ capture: '/x/prod.png', diff: '/x/prod-diff.png' });
  });
});

// 6. broken-image names are full srcs, not basenames
describe('broken image names', () => {
  it('suggest input carries the full src (first 3) instead of "0.jpg"', () => {
    const jsonData = {
      metadata: meta([
        img({ src: 'https://shop.example/img/0.jpg' }),
        img({ src: 'https://shop.example/img/1.jpg' }),
        img({ src: 'https://shop.example/img/2.jpg' }),
        img({ src: 'https://shop.example/img/3.jpg' }),
      ]),
    };
    const input = buildSuggestInput(jsonData, undefined, false);
    expect(input.brokenImageSrcs).toEqual([
      'https://shop.example/img/0.jpg',
      'https://shop.example/img/1.jpg',
      'https://shop.example/img/2.jpg',
    ]);
  });
  it('oversized-image hint prints the full src', () => {
    const text = formatMetadata(
      meta([img({ broken: false, naturalWidth: 2400, naturalHeight: 1600, displayWidth: 600, displayHeight: 400 })]),
    );
    expect(text).toContain('- https://shop.example/img/0.jpg: 2400x1600 displayed at 600x400');
  });
});

// 2 + 7. failed same-origin asset requests: signal, --json shape, CSP-blocked vs 404
describe('failed-requests', () => {
  const list = [
    { url: 'https://shop.example/app.css', status: 404, type: 'stylesheet' },
    { url: 'https://shop.example/img/hero.jpg', error: 'net::ERR_ABORTED', type: 'image' },
  ];
  it('tracks only css/js/img/font resource types', () => {
    for (const t of ['stylesheet', 'script', 'image', 'font']) expect(fr.isTrackedAssetType(t)).toBe(true);
    for (const t of ['document', 'xhr', 'fetch', 'websocket', 'other']) expect(fr.isTrackedAssetType(t)).toBe(false);
  });
  it('same-origin means same scheme+host+port as the page', () => {
    expect(fr.isSameOrigin('https://shop.example/a.css', 'https://shop.example/de/')).toBe(true);
    expect(fr.isSameOrigin('https://cdn.example/a.css', 'https://shop.example/de/')).toBe(false);
    expect(fr.isSameOrigin('http://shop.example/a.css', 'https://shop.example/')).toBe(false);
  });
  it('formats one warning line naming the count and the first failure', () => {
    expect(fr.formatFailedRequests(list)).toBe('⚠ 2 asset(s) failed (first: https://shop.example/app.css — 404)');
    expect(fr.formatFailedRequests([list[1]])).toBe(
      '⚠ 1 asset(s) failed (first: https://shop.example/img/hero.jpg — net::ERR_ABORTED)',
    );
  });
  it('classifies a broken <img> as failed (with the status/error) or blocked (no failed request)', () => {
    expect(fr.classifyBrokenImage('https://shop.example/img/hero.jpg', list)).toEqual({ kind: 'failed', reason: 'net::ERR_ABORTED' });
    expect(fr.classifyBrokenImage('https://shop.example/app.css', list)).toEqual({ kind: 'failed', reason: '404' });
    expect(fr.classifyBrokenImage('https://shop.example/img/other.jpg', list)).toEqual({
      kind: 'blocked',
      reason: 'blocked (CSP or ad-blocker?)',
    });
  });
  it('Broken Images section labels each entry with its classification', () => {
    const text = formatMetadata(
      meta([
        img({ src: 'https://shop.example/img/a.jpg', loadStatus: { kind: 'blocked', reason: 'blocked (CSP or ad-blocker?)' } } as any),
        img({ src: 'https://shop.example/img/b.jpg', loadStatus: { kind: 'failed', reason: '404' } } as any),
      ]),
    );
    expect(text).toContain('- https://shop.example/img/a.jpg (alt: "") — blocked (CSP or ad-blocker?)');
    expect(text).toContain('- https://shop.example/img/b.jpg (alt: "") — 404');
  });
  it('suggest splits blocked images out of the broken count', () => {
    const jsonData = {
      metadata: meta([
        img({ src: 'https://shop.example/img/a.jpg', loadStatus: { kind: 'blocked', reason: 'blocked (CSP or ad-blocker?)' } } as any),
        img({ src: 'https://shop.example/img/b.jpg', loadStatus: { kind: 'failed', reason: '404' } } as any),
      ]),
    };
    const input = buildSuggestInput(jsonData, undefined, false) as any;
    expect(input.brokenImages).toBe(1);
    expect(input.brokenImageSrcs).toEqual(['https://shop.example/img/b.jpg']);
    expect(input.blockedImages).toBe(1);
    expect(input.blockedImageSrcs).toEqual(['https://shop.example/img/a.jpg']);
  });
});

// 8. --check status:<code>, 2. --check assets-ok — Node-side assertions
describe('--check status:<code> and assets-ok', () => {
  it('are known assertions and documented in CHECK_ASSERTIONS', () => {
    expect(check.isKnownAssertion('status:404')).toBe(true);
    expect(check.isKnownAssertion('assets-ok')).toBe(true);
    expect(check.isKnownAssertion('status:abc')).toBe(false);
    const doc = check.CHECK_ASSERTIONS.map((a) => a.syntax);
    expect(doc).toContain('status:<code>');
    expect(doc).toContain('assets-ok');
  });
  it('status:<code> passes on an equal main-document status and fails otherwise', () => {
    expect(ck.evaluateStatusAssertion('status:404', 404)).toEqual({ assertion: 'status:404', pass: true, detail: 'HTTP 404' });
    expect(ck.evaluateStatusAssertion('status:404', 200)).toEqual({ assertion: 'status:404', pass: false, detail: 'got 200' });
    expect(ck.evaluateStatusAssertion('status:200', undefined)).toEqual({
      assertion: 'status:200',
      pass: false,
      detail: 'no response status recorded',
    });
  });
  it('assets-ok fails when any same-origin asset request failed', () => {
    expect(ck.evaluateAssetsOk([])).toEqual({ assertion: 'assets-ok', pass: true, detail: 'no failed asset requests' });
    expect(
      ck.evaluateAssetsOk([{ url: 'https://shop.example/app.css', status: 404, type: 'stylesheet' }]),
    ).toEqual({ assertion: 'assets-ok', pass: false, detail: '1 failed: https://shop.example/app.css (404)' });
  });
});

// 9. fleet --design-audit defaults --fail-only on
describe('applyFleetDefaults', () => {
  it('turns --fail-only on for fleet --design-audit', () => {
    const v: Record<string, any> = { 'design-audit': true, 'fail-only': false, 'no-fail-only': false };
    cu.applyFleetDefaults(v);
    expect(v['fail-only']).toBe(true);
  });
  it('leaves --fail-only alone without --design-audit or with --no-fail-only', () => {
    const a: Record<string, any> = { 'design-audit': false, 'fail-only': false, 'no-fail-only': false };
    cu.applyFleetDefaults(a);
    expect(a['fail-only']).toBe(false);
    const b: Record<string, any> = { 'design-audit': true, 'fail-only': false, 'no-fail-only': true };
    cu.applyFleetDefaults(b);
    expect(b['fail-only']).toBe(false);
  });
});

// 11. FEEDBACK 2026-08-29 (docforum UI audit): "fonts: none detected" reads as a warning on a
// deliberate system-font stack. document.fonts is empty exactly when no @font-face exists.
describe('fonts summary on a system-font stack', () => {
  it('says "system stack (none loaded)" instead of "none detected"', () => {
    expect(summarize('fonts', [])).toBe('fonts: system stack (none loaded)');
  });
  it('keeps the loaded-fonts wording unchanged', () => {
    const fonts = [
      { family: 'Inter', weight: '400', style: 'normal', status: 'loaded' },
      { family: 'Inter', weight: '700', style: 'normal', status: 'loaded' },
    ];
    expect(summarize('fonts', fonts)).toBe('fonts: 2 (Inter)');
  });
});

// 12. FEEDBACK 2026-08-29: fleet filenames for localhost audits carry no port, so two local
// apps collide (preview-127-0-0-1-<path>). Loopback hosts get the port in the slug.
describe('urlToOutputSuffix includes the port for loopback hosts', () => {
  it('localhost / 127.0.0.1 carry their port', () => {
    expect(cliUtils.urlToOutputSuffix('http://localhost:4321/de/')).toBe('localhost-4321-de');
    expect(cliUtils.urlToOutputSuffix('http://127.0.0.1:4321/')).toBe('127-0-0-1-4321');
    expect(cliUtils.urlToOutputSuffix('http://localhost/')).toBe('localhost-80');
  });
  it('public hosts are unchanged', () => {
    expect(cliUtils.urlToOutputSuffix('https://a.com/de/')).toBe('a-com-de');
    expect(cliUtils.urlToOutputSuffix('https://a.com:8443/')).toBe('a-com');
  });
});

// 10. --consent-selector <css> implies --dismiss-consent
describe('resolveConsentMode', () => {
  it('maps the flags to { dismiss, selector }', () => {
    expect(cu.resolveConsentMode({})).toEqual({ dismiss: false, selector: undefined });
    expect(cu.resolveConsentMode({ 'dismiss-consent': true })).toEqual({ dismiss: true, selector: undefined });
    expect(cu.resolveConsentMode({ 'consent-selector': '#accept-all' })).toEqual({ dismiss: true, selector: '#accept-all' });
  });
});
