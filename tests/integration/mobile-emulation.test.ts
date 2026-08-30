// Acceptance tests for plans/2026-08-30-mobile-emulation.md — real Chromium via bin/looksy.js.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');

function run(...args: string[]) {
  return spawnSync('node', [BIN, ...args], { timeout: 30_000, encoding: 'utf-8' });
}
function runWithStdin(input: string, ...args: string[]) {
  return spawnSync('node', [BIN, ...args], { input, timeout: 30_000, encoding: 'utf-8' });
}

const META = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const DOC = (body: string, head = META) => `<!doctype html><html><head>${head}</head><body style="margin:0">${body}</body></html>`;

describe('device emulation', () => {
  it('--mobile: Page line names the device, PNG is 1 px per CSS px (390 wide, not 1170)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-emu-'));
    const out = join(dir, 'm.png');
    try {
      const r = runWithStdin(DOC('<h1>Hi</h1>'), '--html', '--mobile', '-o', out);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Page: 390x\d+px · device: iPhone 14 @3x touch/);
      expect(existsSync(out)).toBe(true);
      expect(PNG.sync.read(readFileSync(out)).width).toBe(390);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('--mobile: the page sees hover:none / pointer:coarse / DPR 3 / iPhone UA', () => {
    const html = DOC(
      '<div id="o"></div><script>document.getElementById("o").textContent=[matchMedia("(hover: none)").matches,matchMedia("(pointer: coarse)").matches,devicePixelRatio,/iPhone/.test(navigator.userAgent)].join("|")</script>',
    );
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'text:true|true|3|true');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] text:true|true|3|true');
  }, 30_000);

  it('--device "Pixel 7": descriptor viewport 412 wide, DPR 2.625', () => {
    const r = runWithStdin(DOC('<h1>Hi</h1>'), '--html', '--device', 'Pixel 7');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Page: 412x\d+px · device: Pixel 7 @2\.625x touch/);
  }, 30_000);

  it('--device with an unknown name exits 1 and points at --list-devices', () => {
    const r = runWithStdin(DOC('<h1>Hi</h1>'), '--html', '--device', 'Nope');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown device "Nope" — see looksy --list-devices');
  }, 30_000);

  it('--list-devices prints the Playwright registry, one name per line', () => {
    const r = run('--list-devices');
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toContain('iPhone 14');
    expect(lines).toContain('Pixel 7');
    expect(lines).toContain('iPad (gen 7)');
    expect(lines.length).toBeGreaterThan(100);
  }, 10_000);

  it('--mobile on a page without <meta name=viewport> warns that phones render it zoomed out', () => {
    const r = runWithStdin(DOC('<h1>Hi</h1>', ''), '--html', '--mobile');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('⚠ no <meta name=viewport> — real phones render this at 980px zoomed out');
    const ok = runWithStdin(DOC('<h1>Hi</h1>'), '--html', '--mobile');
    expect(ok.stdout).not.toContain('no <meta name=viewport>');
  }, 30_000);

  it('--sweep breakpoints ≤ 768 run with touch media (hover:none) and say so on the Page line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-sweep-'));
    try {
      const html = DOC('<div id="o"></div><script>document.getElementById("o").textContent=matchMedia("(hover: none)").matches?"touchy":"mousey"</script>');
      const r = runWithStdin(html, '--html', '--sweep', '--sweep-widths', '375,1440', '-o', join(dir, 's.png'));
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/375px .*· touch/);
      expect(r.stdout).not.toMatch(/1440px .*· touch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('--interact tap / swipe', () => {
  it('tap:<sel> works under --mobile', () => {
    const html = DOC('<button id="b" style="width:80px;height:44px" onclick="this.textContent=\'tapped\'">go</button>');
    const r = runWithStdin(html, '--html', '--mobile', '--interact', 'tap:#b', '--check', 'text:tapped');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] text:tapped');
  }, 30_000);

  it('tap:<sel> without a touch context does not tap (needs --mobile/--tablet/--device)', () => {
    const html = DOC('<button id="b" onclick="this.textContent=\'tapped\'">go</button>');
    const r = runWithStdin(html, '--html', '--interact', 'tap:#b', '--check', 'text:tapped');
    expect(r.stdout).toContain('[FAIL] text:tapped');
  }, 30_000);

  it('swipe:left fires touch listeners without any touch context (CDP)', () => {
    const html = DOC(
      '<div id="o" style="height:400px"></div><script>let sx;document.addEventListener("touchstart",e=>{sx=e.touches[0].clientX});document.addEventListener("touchend",e=>{document.getElementById("o").textContent=e.changedTouches[0].clientX<sx-50?"swiped-left":"nope"})</script>',
    );
    const r = runWithStdin(html, '--html', '--interact', 'swipe:left,wait:200', '--check', 'text:swiped-left');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] text:swiped-left');
  }, 30_000);

  it('swipe:<sel>=left scrolls a native overflow carousel', () => {
    const html = DOC(
      '<style>#c{width:300px;overflow-x:auto;display:flex}#c div{flex:0 0 300px;height:100px}</style>' +
        '<div id="c"><div>a</div><div>b</div><div>c</div></div><div id="o"></div>' +
        '<script>document.getElementById("c").addEventListener("scroll",()=>{document.getElementById("o").textContent="scrolled"})</script>',
    );
    const r = runWithStdin(html, '--html', '--interact', 'swipe:#c=left=120,wait:400', '--check', 'text:scrolled');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] text:scrolled');
  }, 30_000);
});

describe('--check input-zoom', () => {
  it('FAIL lists text-like controls under 16px with tag[type], size and label', () => {
    const html = DOC(
      '<input type="search" placeholder="Search" style="font-size:14px"><select style="font-size:13px"><option>A</option></select>' +
        '<input type="email" style="font-size:16px"><input type="checkbox" style="font-size:10px"><input type="hidden" style="font-size:8px">',
    );
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'input-zoom');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('[FAIL] input-zoom — 2/3 controls < 16px: input[search] 14px "Search"; select 13px ""');
  }, 30_000);

  it('PASS when every control is ≥ 16px; hidden controls are skipped', () => {
    const html = DOC('<input placeholder="q" style="font-size:16px"><textarea style="font-size:17px"></textarea><input style="font-size:10px;display:none">');
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'input-zoom');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] input-zoom — all 2 form controls ≥ 16px');
  }, 30_000);

  it('PASS "no form controls" on a page without inputs', () => {
    const r = runWithStdin(DOC('<h1>Hi</h1>'), '--html', '--mobile', '--check', 'input-zoom');
    expect(r.stdout).toContain('[PASS] input-zoom — no form controls');
  }, 30_000);

  it('maximum-scale=1 does not hide the failure — it is named as an Android pinch-zoom blocker', () => {
    const html = DOC(
      '<input placeholder="q" style="font-size:14px">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">',
    );
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'input-zoom');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('[FAIL] input-zoom — 1/1 controls < 16px: input 14px "q" — meta viewport maximum-scale=1 masks the zoom but blocks pinch-zoom on Android (WCAG 1.4.4)');
  }, 30_000);
});

describe('--check hover-nav', () => {
  const NAV = '<nav><ul><li><a href="#">Products</a><ul class="submenu"><li><a href="#">Widgets</a></li></ul></li></ul></nav>';

  it('FAIL: submenu revealed only by :hover, no focus/click alternative', () => {
    const html = DOC(`<style>.submenu{display:none} li:hover > .submenu{display:block}</style>${NAV}`);
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'hover-nav');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('[FAIL] hover-nav — 1 hover-only submenus in nav: li:hover > .submenu ("Products")');
  }, 30_000);

  it('PASS: a :focus-within twin of the hover rule makes it keyboard/touch reachable', () => {
    const html = DOC(`<style>.submenu{display:none} li:hover > .submenu{display:block} li:focus-within > .submenu{display:block}</style>${NAV}`);
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'hover-nav');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] hover-nav — 0 hover-only submenus (1 hover rules checked)');
  }, 30_000);

  it('PASS: a toggle control (button/[aria-expanded]/summary) next to the submenu counts as an alternative', () => {
    const html = DOC(
      '<style>.submenu{display:none} li:hover > .submenu{display:block}</style>' +
        '<nav><ul><li><a href="#">Products</a><button aria-expanded="false">▾</button><ul class="submenu"><li><a href="#">Widgets</a></li></ul></li></ul></nav>',
    );
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'hover-nav');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] hover-nav');
  }, 30_000);

  it('PASS: hover rules scoped to @media (hover: hover) are ignored', () => {
    const html = DOC(`<style>.submenu{display:none} @media (hover: hover){ li:hover > .submenu{display:block} }</style>${NAV}`);
    const r = runWithStdin(html, '--html', '--mobile', '--check', 'hover-nav');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[PASS] hover-nav — 0 hover-only submenus (0 hover rules checked)');
  }, 30_000);
});
