// Acceptance tests for plans/2026-08-30-mobile-emulation.md — pure functions only.
import { describe, it, expect } from 'vitest';
import { viewports, contextEmulationOpts, touchEmulationFor } from '../../src/viewports.js';
import { resolveViewport } from '../../src/cli-utils.js';
import { parseInteractions } from '../../src/interact.js';
import { CHECK_ASSERTIONS, isKnownAssertion, knownAssertionHint } from '../../src/check.js';
import { toFindings } from '../../src/findings.js';
import { formatPageLine } from '../../src/cli-output.js';
import { applyCompoundFlags } from '../../dist/cli.js';

describe('viewports carry device emulation', () => {
  it('mobile = looksy 390x844 + iPhone 14 descriptor (UA, DPR 3, isMobile, hasTouch)', () => {
    expect(viewports.mobile).toMatchObject({ width: 390, height: 844 });
    expect(viewports.mobile.emulation).toMatchObject({
      device: 'iPhone 14',
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    expect(viewports.mobile.emulation?.userAgent).toMatch(/iPhone/);
  });

  it('tablet = looksy 768x1024 + iPad (gen 7) descriptor (DPR 2)', () => {
    expect(viewports.tablet).toMatchObject({ width: 768, height: 1024 });
    expect(viewports.tablet.emulation).toMatchObject({
      device: 'iPad (gen 7)',
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    expect(viewports.tablet.emulation?.userAgent).toMatch(/iPad/);
  });

  it('desktop has no emulation', () => {
    expect(viewports.desktop).toEqual({ width: 1280, height: 800 });
  });

  it('contextEmulationOpts strips the device label and passes the rest to newContext', () => {
    const opts = contextEmulationOpts(viewports.mobile.emulation);
    expect(opts).toEqual({
      userAgent: viewports.mobile.emulation!.userAgent,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    expect(contextEmulationOpts(undefined)).toEqual({});
  });

  it('touchEmulationFor: hasTouch only (no isMobile, no DPR) at ≤ 768px, nothing above', () => {
    expect(touchEmulationFor(320)).toEqual({ hasTouch: true });
    expect(touchEmulationFor(375)).toEqual({ hasTouch: true });
    expect(touchEmulationFor(768)).toEqual({ hasTouch: true });
    expect(touchEmulationFor(1024)).toBeUndefined();
    expect(touchEmulationFor(1440)).toBeUndefined();
  });
});

describe('resolveViewport with emulation and --device', () => {
  it('--mobile keeps 390x844 and attaches the iPhone 14 emulation', () => {
    const vp = resolveViewport({ mobile: true });
    expect(vp).toMatchObject({ width: 390, height: 844 });
    expect(vp.emulation?.device).toBe('iPhone 14');
  });

  it('--mobile --width 400 keeps the emulation at the custom width', () => {
    const vp = resolveViewport({ mobile: true, width: '400' });
    expect(vp).toMatchObject({ width: 400, height: 844 });
    expect(vp.emulation?.device).toBe('iPhone 14');
  });

  it('--viewport WxH and --width/--height alone carry no emulation', () => {
    expect(resolveViewport({ viewport: '390x844' })).toEqual({ width: 390, height: 844 });
    expect(resolveViewport({ width: '390', height: '844' })).toEqual({ width: 390, height: 844 });
  });

  it('--device "Pixel 7" uses the descriptor viewport and full emulation', () => {
    const vp = resolveViewport({ device: 'Pixel 7' });
    expect(vp).toMatchObject({ width: 412, height: 839 });
    expect(vp.emulation).toMatchObject({
      device: 'Pixel 7',
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    });
    expect(vp.emulation?.userAgent).toMatch(/Pixel 7/);
  });

  it('unknown device name errors and points at --list-devices', () => {
    expect(() => resolveViewport({ device: 'Nope' })).toThrow(
      /unknown device "Nope" — see looksy --list-devices/,
    );
  });

  it('--device refuses to combine with the other viewport flags', () => {
    for (const extra of [
      { mobile: true },
      { tablet: true },
      { width: '400' },
      { height: '900' },
      { viewport: '390x844' },
      { multi: true },
      { sweep: true },
    ]) {
      expect(() => resolveViewport({ device: 'Pixel 7', ...extra })).toThrow(
        /--device cannot be combined with --mobile\/--tablet\/--width\/--height\/--viewport\/--multi\/--sweep/,
      );
    }
  });
});

describe('--interact tap / swipe grammar', () => {
  it('tap:<selector>', () => {
    expect(parseInteractions('tap:#buy')).toEqual([{ type: 'tap', target: '#buy' }]);
  });

  it('swipe:<dir> from the viewport centre, default distance omitted at parse time', () => {
    expect(parseInteractions('swipe:left')).toEqual([{ type: 'swipe', direction: 'left' }]);
  });

  it('swipe:<dir>=<px>', () => {
    expect(parseInteractions('swipe:right=300')).toEqual([
      { type: 'swipe', direction: 'right', distance: 300 },
    ]);
  });

  it('swipe:<selector>=<dir>[=<px>] starts from the element centre', () => {
    expect(parseInteractions('swipe:#carousel=left')).toEqual([
      { type: 'swipe', target: '#carousel', direction: 'left' },
    ]);
    expect(parseInteractions('swipe:.hero=up=120')).toEqual([
      { type: 'swipe', target: '.hero', direction: 'up', distance: 120 },
    ]);
  });

  it('unknown swipe direction is dropped like any malformed part', () => {
    expect(parseInteractions('swipe:diagonal,click:.x')).toEqual([{ type: 'click', target: '.x' }]);
  });
});

describe('input-zoom / hover-nav check vocabulary', () => {
  it('both are documented bare assertions', () => {
    const syntaxes = CHECK_ASSERTIONS.map((a) => a.syntax);
    expect(syntaxes).toContain('input-zoom');
    expect(syntaxes).toContain('hover-nav');
    expect(isKnownAssertion('input-zoom')).toBe(true);
    expect(isKnownAssertion('hover-nav')).toBe(true);
    expect(knownAssertionHint()).toContain('input-zoom');
  });

  it('--design-audit appends input-zoom only for a mobile/tablet/device capture', () => {
    const desktop: Record<string, any> = { 'design-audit': true };
    applyCompoundFlags(desktop);
    expect(desktop.check).toBe('no generator, self-hosted-fonts, contrast:aa');
    for (const extra of [{ mobile: true }, { tablet: true }, { device: 'Pixel 7' }]) {
      const v: Record<string, any> = { 'design-audit': true, ...extra };
      applyCompoundFlags(v);
      expect(v.check).toBe('no generator, self-hosted-fonts, contrast:aa, input-zoom');
    }
  });

  it('failed input-zoom / hover-nav checks point at --mobile', () => {
    const findings = toFindings([
      {
        url: 'https://a.example/',
        result: {
          imagePath: 'x',
          checkResultsData: [
            { assertion: 'input-zoom', pass: false, detail: '1/2 controls < 16px: input[search] 14px "Search"' },
            { assertion: 'hover-nav', pass: false, detail: '1 hover-only submenus in nav: li:hover > .submenu ("Products")' },
          ],
        } as any,
      },
    ]);
    expect(findings.map((f) => f.hint)).toEqual(['--mobile', '--mobile']);
    expect(findings[0].id).toMatch(/\/input-zoom$/);
    expect(findings[0].severity).toBe('crit');
  });
});

describe('Page line device readout', () => {
  const base = { imagePath: 'x', pageInfo: { width: 390, height: 2000, title: 'T', viewportWidth: 390 } };

  it('full emulation → " · device: <name> @<dpr>x touch"', () => {
    const emulation = { device: 'iPhone 14', deviceScaleFactor: 3, isMobile: true, hasTouch: true, viewportMeta: true };
    expect(formatPageLine({ ...base, pageInfo: { ...base.pageInfo, emulation } })).toBe(
      'Page: 390x2000px · device: iPhone 14 @3x touch "T"',
    );
  });

  it('touch-only emulation (sweep/responsive breakpoints) → " · touch"', () => {
    const emulation = { hasTouch: true, viewportMeta: true };
    expect(formatPageLine({ ...base, pageInfo: { ...base.pageInfo, width: 375, height: 900, emulation } })).toBe(
      'Page: 375x900px · touch "T"',
    );
  });

  it('no emulation → unchanged line', () => {
    expect(formatPageLine(base)).toBe('Page: 390x2000px "T"');
  });
});
