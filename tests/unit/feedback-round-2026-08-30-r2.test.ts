import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as batchReport from '../../src/batch-report.js';
import * as seo from '../../src/seo.js';
import * as responsive from '../../src/responsive-check.js';
import { summarize } from '../../src/analysis-summary.js';
import { CHECK_ASSERTIONS } from '../../src/check.js';
import * as failed from '../../src/failed-requests.js';
import * as help from '../../src/cli-help.js';
import * as cliOutput from '../../src/cli-output.js';
import * as cliUtils from '../../src/cli-utils.js';

// Acceptance tests for plans/2026-08-30-feedback-round.md (FEEDBACK 2026-08-30, field
// walkthrough + aiforum UI round). Namespace imports + `as any` so each missing export fails
// its own test ("… is not a function") instead of the whole file.
const br = batchReport as any;
const so = seo as any;
const rc = responsive as any;
const fr = failed as any;
const hp = help as any;
const co = cliOutput as any;
const cu = cliUtils as any;

function seoData(over: Record<string, any> = {}): any {
  return {
    title: 'T',
    description: 'd',
    canonical: 'https://shop.example/',
    generator: null,
    favicon: null,
    og: { 'og:title': 'T', 'og:image': 'https://shop.example/og.png' },
    twitter: {},
    hreflang: [],
    schemaTypes: [],
    robotsTxt: { exists: true, lines: 2 },
    sitemap: { exists: true },
    ...over,
  };
}

function result(jsonData: Record<string, any>): any {
  return { imagePath: '/tmp/x.png', url: 'https://shop.example/', jsonData };
}

// 1. batch-report "SEO Issues" column read `og.title` while seo.ts stores `og:title` →
//    "no-og-title" counted on every page of every site.
describe('batch-report SEO Issues column', () => {
  it('counts 0 issues for a page whose og:title is present (og keys are "og:title")', () => {
    const row = br.extractBatchRow('https://shop.example/', result({ seo: seoData() }));
    expect(row.seoIssues).toBe(0);
  });
  it('still counts a missing og:title', () => {
    const row = br.extractBatchRow('https://shop.example/', result({ seo: seoData({ og: {} }) }));
    expect(row.seoIssues).toBe(1);
  });
  it('carries robots.txt Disallow: / as a site-level flag, not a per-page issue', () => {
    const row = br.extractBatchRow(
      'https://shop.example/',
      result({ seo: seoData({ robotsTxt: { exists: true, lines: 2, disallowAll: true } }) }),
    );
    expect(row.seoIssues).toBe(0);
    expect(row.robotsDisallowAll).toBe(true);
  });
  it('surfaces Disallow: / once in the batch summary', () => {
    const withFlag = br.formatBatchReport([
      { url: 'https://shop.example/', seoIssues: 0, robotsDisallowAll: true },
      { url: 'https://shop.example/a', seoIssues: 0, robotsDisallowAll: true },
    ]);
    expect(withFlag).toContain('robots.txt disallows all (Disallow: /)');
    expect(withFlag.match(/disallows all/g)?.length).toBe(1);
    const without = br.formatBatchReport([{ url: 'https://shop.example/', seoIssues: 0 }]);
    expect(without).not.toContain('disallows all');
  });
});

describe('seo.ts robots.txt Disallow: / detection', () => {
  it('parseRobotsDisallowAll matches a bare "Disallow: /" line only', () => {
    expect(so.parseRobotsDisallowAll('User-agent: *\nDisallow: /\n')).toBe(true);
    expect(so.parseRobotsDisallowAll('User-agent: *\ndisallow:   /   \n')).toBe(true);
    expect(so.parseRobotsDisallowAll('User-agent: *\nDisallow: /admin\n')).toBe(false);
    expect(so.parseRobotsDisallowAll('User-agent: *\nDisallow:\n')).toBe(false);
    expect(so.parseRobotsDisallowAll('')).toBe(false);
  });
  it('verbose formatSeo names the block; the compact per-page line stays "no issues"', () => {
    const data = seoData({ robotsTxt: { exists: true, lines: 2, disallowAll: true } });
    expect(so.formatSeo(data)).toContain('Disallow: / — site blocked from indexing');
    const compact = so.formatSeo(data, { compact: true });
    expect(compact).toContain('no issues');
    expect(compact).not.toContain('Disallow');
  });
});

// 2. Touch targets: FAIL keyed on WCAG 2.2 SC 2.5.8 AA (24px); 44px (SC 2.5.5 AAA / HIG) is an
//    advisory count, not a failure.
describe('touch-target threshold', () => {
  const bp = (over: Record<string, any> = {}): any => ({
    width: 375,
    label: 'Mobile',
    issues: [],
    hasHorizontalOverflow: false,
    smallTouchTargets: 0,
    tinyText: 0,
    pageHeight: 2000,
    touchTargetDetails: [],
    tinyTextDetails: [],
    ...over,
  });

  it('DEFAULT_TARGET_SIZE is 24', () => {
    expect(rc.DEFAULT_TARGET_SIZE).toBe(24);
  });
  it('formatResponsiveCheck falls back to 24px when the result carries no targetSize', () => {
    const out = rc.formatResponsiveCheck({
      breakpoints: [
        bp({
          issues: [{ severity: 'MEDIUM', message: '1 control smaller than 24px minimum' }],
          smallTouchTargets: 1,
          touchTargetDetails: [
            { tag: 'button', text: 'x', className: '', width: 20, height: 20, inlineExempt: false },
          ],
        }),
      ],
      totalIssues: 1,
    });
    expect(out).toContain('< 24px');
    expect(out).not.toContain('< 44px');
  });
  it('reports the AAA (< 44px) count as an advisory line in verbose and compact output', () => {
    const res = {
      breakpoints: [bp({ touchTargetsBelow44: 12 }), bp({ width: 768, label: 'Tablet', touchTargetsBelow44: 9 }), bp({ width: 1440, label: 'Desktop', touchTargetsBelow44: 0 })],
      totalIssues: 0,
      targetSize: 24,
    };
    const verbose = rc.formatResponsiveCheck(res);
    expect(verbose).toContain('AAA advisory (< 44px, not counted): 375px 12 · 768px 9');
    const compact = rc.formatResponsiveCheck(res, { compact: true });
    expect(compact).toContain('## Responsive: No issues');
    expect(compact).toContain('AAA advisory (< 44px, not counted): 375px 12 · 768px 9');
  });
  it('omits the advisory line when nothing is below 44px', () => {
    const res = { breakpoints: [bp({ touchTargetsBelow44: 0 })], totalIssues: 0, targetSize: 24 };
    expect(rc.formatResponsiveCheck(res)).not.toContain('AAA advisory');
    expect(rc.formatResponsiveCheck(res, { compact: true })).not.toContain('AAA advisory');
  });
  it('analysis summary falls back to 24px', () => {
    const s = summarize('responsiveCheck', {
      breakpoints: [{ width: 375, hasHorizontalOverflow: false, smallTouchTargets: 3, tinyText: 0 }],
    });
    expect(s).toBe('responsive: 375px 3 controls < 24px');
  });
  it('--check touch-targets documents the 24px default', () => {
    const entry = CHECK_ASSERTIONS.find((a) => a.syntax === 'touch-targets[:N]');
    expect(entry?.description).toContain('default 24');
  });
  it('batch report labels the column as AA', () => {
    const out = br.formatBatchReport([
      { url: 'https://shop.example/', touchTargetFails: 0, hasOverflow: false },
    ]);
    expect(out).toContain('Touch Targets (AA)');
  });
});

// 3. /cdn-cgi/ assets are Cloudflare-injected (email-decode, rocket-loader, image resizing) —
//    never a site bug, so never a failed-asset warning or an assets-ok failure.
describe('cloudflare-injected assets', () => {
  it('isInjectedAsset recognises /cdn-cgi/ paths on any host', () => {
    expect(
      fr.isInjectedAsset('https://shop.example/cdn-cgi/scripts/7d0fa10a/cloudflare-static/email-decode.min.js'),
    ).toBe(true);
    expect(fr.isInjectedAsset('https://shop.example/cdn-cgi/image/w=400/hero.jpg')).toBe(true);
    expect(fr.isInjectedAsset('https://shop.example/assets/app.js')).toBe(false);
    expect(fr.isInjectedAsset('not a url')).toBe(false);
  });
  it('formatFailedRequests appends the ignored count only when non-zero', () => {
    const list = [{ url: 'https://shop.example/app.css', status: 404, type: 'stylesheet' }];
    expect(fr.formatFailedRequests(list)).toBe(
      '⚠ 1 asset(s) failed (first: https://shop.example/app.css — 404)',
    );
    expect(fr.formatFailedRequests(list, 0)).toBe(
      '⚠ 1 asset(s) failed (first: https://shop.example/app.css — 404)',
    );
    expect(fr.formatFailedRequests(list, 2)).toBe(
      '⚠ 1 asset(s) failed (first: https://shop.example/app.css — 404) (+2 cloudflare-injected ignored)',
    );
  });
});

// 4. --help <section>: the 195-line help costs an agent two paged reads; one section at a time.
describe('--help <section>', () => {
  const NAMES = [
    'Usage',
    'Capture options',
    'Metadata & analysis',
    'Token-saving',
    'Capture modes',
    'Auth & consent',
    'Comparison & diffing',
    'Batch & multi-page',
    'Watch & server',
    'Export',
    'Advanced',
    'Environment',
  ];
  it('helpSectionNames lists the 12 headings in order', () => {
    expect(hp.helpSectionNames()).toEqual(NAMES);
  });
  it('helpSection matches by case-insensitive prefix of the heading or any word in it', () => {
    const batch = hp.helpSection('batch');
    expect(batch).toContain('--pages-limit');
    expect(batch).not.toContain('--cdp');
    const capture = hp.helpSection('CAPTURE'); // both "Capture options" and "Capture modes"
    expect(capture).toContain('--mobile');
    expect(capture).toContain('--sweep');
    const auth = hp.helpSection('auth'); // word match: "Auth & consent"
    expect(auth).toContain('--storage-state');
    expect(auth).toContain('--save-storage-state');
    expect(hp.helpSection('nope')).toBeUndefined();
  });
  it('printHelp() prints a Sections: line right after the title and returns true', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ok = hp.printHelp();
    const lines = log.mock.calls.map((c) => c.join(' ')).join('\n').split('\n');
    log.mockRestore();
    expect(ok).toBe(true);
    expect(lines[0]).toContain('looksy — screenshot any URL');
    expect(lines[1]).toMatch(/^Sections: usage · capture options · .* — looksy --help <section>$/);
    expect(lines.join('\n')).toContain('Quote URLs containing ? or &');
  });
  it('printHelp(unknown) lists the sections on stderr and returns false', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = hp.printHelp('nope');
    const stderr = err.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    err.mockRestore();
    expect(ok).toBe(false);
    expect(stderr).toContain('unknown help section "nope"');
    expect(stderr).toContain('batch & multi-page');
  });
});

// 5. Default-path overwrite note + 6. scrollY readout on the Page line.
describe('default-output overwrite note', () => {
  it('formatOverwriteNote names the previous write time and age', () => {
    const now = Date.parse('2026-08-30T10:00:00');
    expect(co.formatOverwriteNote(now - 5_000, now)).toMatch(
      /^note: replaced previous default capture \(written \d{2}:\d{2}:\d{2}, 5s ago\)$/,
    );
    expect(co.formatOverwriteNote(now - 90_000, now)).toContain(', 1m ago)');
    expect(co.formatOverwriteNote(now - 2 * 3600_000, now)).toContain(', 2h ago)');
  });
  it('newestMtimeMs ignores missing files and returns the newest mtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-r2-'));
    try {
      expect(cu.newestMtimeMs([join(dir, 'missing.png')])).toBeUndefined();
      const a = join(dir, 'a.png');
      writeFileSync(a, 'x');
      expect(cu.newestMtimeMs([join(dir, 'missing.png'), a])).toBe(statSync(a).mtimeMs);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Page line scrollY readout', () => {
  const base = { pageInfo: { width: 1280, height: 3000, title: 'T', viewportWidth: 1280 } };
  it('appends · scrollY: <px> when the capture was taken at an offset', () => {
    expect(co.formatPageLine({ ...base, scheme: 'light', scrollY: 2000 })).toBe(
      'Page: 1280x3000px · scheme: light · scrollY: 2000px "T"',
    );
  });
  it('stays unchanged at the top of the page', () => {
    expect(co.formatPageLine({ ...base, scheme: 'light' })).toBe(
      'Page: 1280x3000px · scheme: light "T"',
    );
  });
});
