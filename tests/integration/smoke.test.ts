import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../../bin/looksy.js');
const OUTPUT = '/tmp/looksy/test-smoke.png';

function run(...args: string[]) {
  return spawnSync('node', [BIN, ...args], {
    timeout: 60_000,
    encoding: 'utf-8',
  });
}

function runWithStdin(input: string, ...args: string[]) {
  return spawnSync('node', [BIN, ...args], {
    input,
    timeout: 30_000,
    encoding: 'utf-8',
  });
}

describe('smoke tests', () => {
  it('screenshots a URL → exit 0, PNG exists', () => {
    if (existsSync(OUTPUT)) unlinkSync(OUTPUT);
    const result = run('https://example.com', '-o', OUTPUT);
    expect(result.status).toBe(0);
    expect(existsSync(OUTPUT)).toBe(true);
  }, 30_000);

  it('--html pipe → exit 0, PNG exists', () => {
    const output = '/tmp/looksy/test-smoke-html.png';
    if (existsSync(output)) unlinkSync(output);
    const result = runWithStdin('<h1>Hello</h1>', '--html', '-o', output);
    expect(result.status).toBe(0);
    expect(existsSync(output)).toBe(true);
  }, 30_000);

  it('--html --a11y without --fragment flags missing lang (regression)', () => {
    const output = '/tmp/looksy/test-fragment-off.png';
    const meta = output.replace('.png', '.meta.md');
    if (existsSync(meta)) unlinkSync(meta);
    const result = runWithStdin('<main><p>hello</p></main>', '--html', '--a11y', '-o', output);
    expect(result.status).toBe(0);
    expect(readFileSync(meta, 'utf-8')).toContain('Missing lang attribute');
  }, 30_000);

  it('--html --a11y --fragment suppresses missing lang', () => {
    const output = '/tmp/looksy/test-fragment-on.png';
    const meta = output.replace('.png', '.meta.md');
    if (existsSync(meta)) unlinkSync(meta);
    const result = runWithStdin(
      '<main><p>hello</p></main>',
      '--html',
      '--a11y',
      '--fragment',
      '-o',
      output,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(meta, 'utf-8')).not.toContain('Missing lang attribute');
  }, 30_000);

  it('fleet over 2 local URLs → exit 0, both captured (concurrency regression)', () => {
    // High-contrast pages so the fail-on-aa gate passes. Two URLs run concurrently over
    // one shared browser — regression guard for the unconditional browser.close() bug.
    const dir = '/tmp/looksy/test-fleet';
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const page = (h: string) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${h}</title></head>` +
      `<body style="background:#fff;color:#000"><h1>${h}</h1><p>Readable body copy.</p></body></html>`;
    const a = `${dir}/a.html`;
    const b = `${dir}/b.html`;
    writeFileSync(a, page('Alpha'));
    writeFileSync(b, page('Bravo'));

    const result = run('fleet', a, b, '--output-dir', dir);
    expect(result.status).toBe(0);
    const pngs = readdirSync(dir).filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(2);
    expect(existsSync(`${dir}/batch-report.md`)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('--sweep produces a screenshot per breakpoint', () => {
    const dir = '/tmp/looksy/test-sweep';
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const out = `${dir}/preview.png`;
    const html = '<h1 style="color:#000;background:#fff">Sweep</h1>';
    const result = runWithStdin(html, '--html', '--sweep', '--sweep-widths', '375,768', '-o', out);
    expect(result.status).toBe(0);
    const pngs = readdirSync(dir).filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(2);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('--contrast-limit caps the sample and notes it', () => {
    const output = '/tmp/looksy/test-contrast-limit.png';
    const meta = output.replace('.png', '.meta.md');
    if (existsSync(meta)) unlinkSync(meta);
    const html = '<body style="background:#fff;color:#000"><p>One</p><p>Two</p><p>Three</p></body>';
    const result = runWithStdin(
      html,
      '--html',
      '--contrast',
      '--contrast-limit',
      '1',
      '-o',
      output,
    );
    expect(result.status).toBe(0);
    // Coverage note reports sampled/total so partial coverage isn't mistaken for a clean pass.
    const metaText = readFileSync(meta, 'utf-8');
    expect(metaText).toContain('sampled 1/3');
    expect(metaText).toContain('2 unchecked');
  }, 30_000);

  it('--contrast attributes to leaf text nodes (no phantom 1.0:1 from wrappers)', () => {
    const output = '/tmp/looksy/test-contrast-leaf.png';
    const meta = output.replace('.png', '.meta.md');
    if (existsSync(meta)) unlinkSync(meta);
    // A card wrapper whose own color == its own bg (un-renderable, would score 1.0:1) but whose
    // visible text lives in child <span>s, and a footer <li> wrapping its link the same way.
    const html =
      '<body style="background:#fff;color:#000">' +
      '<a class="group" style="color:#fff;background:#fff"><span style="color:#000">Card title</span><span style="color:#111">Card body</span></a>' +
      '<ul><li style="color:#777;background:#777"><a style="color:#003366" href="/p">Privacy policy</a></li></ul>' +
      '</body>';
    const result = runWithStdin(html, '--html', '--contrast', '-o', output);
    expect(result.status).toBe(0);
    const metaText = readFileSync(meta, 'utf-8');
    // The wrapper/li (own color == own bg) are skipped, so their phantom 1.0:1 row never
    // appears. Match the table cell `| 1.0:1` so the legit `21.0:1` doesn't trip the assertion.
    expect(metaText).not.toContain('| 1.0:1');
    expect(metaText).toContain('Card title'); // leaf child text is still scored
  }, 30_000);

  it('--responsive-check excludes sr-only skip links from touch targets', () => {
    const html =
      '<!doctype html><html lang="en"><body style="background:#fff;color:#000">' +
      '<a href="#main" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Skip to main content</a>' +
      '<main id="main"><h1>Title</h1><p>Body copy.</p>' +
      '<a href="/x" style="display:inline-block;width:120px;height:40px">Tap me</a></main></body></html>';
    // Standalone --responsive-check prints its report to stdout (no .meta sidecar).
    const result = runWithStdin(html, '--html', '--responsive-check');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Tap me'); // the real sub-44px target is still flagged
    expect(result.stdout).not.toContain('Skip to main content'); // sr-only excluded
  }, 30_000);

  it('--responsive-check labels nav links as controls, skips focus-only skip links', () => {
    const html =
      '<a class="skip-link" href="#m" style="position:absolute;top:-40px">Skip</a>' +
      '<nav><ul><li><a href="/s" style="display:inline;font-size:12px">Services</a> <span>&middot;</span></li></ul></nav>' +
      '<main id=m><p>Text <a href="/x">inline</a> here.</p></main>';
    const result = runWithStdin(html, '--html', '--responsive-check');
    expect(result.status).toBe(0);
    // "Services" is a nav link — reported as a "nav a" control, not inline-exempt.
    expect(result.stdout).toContain('nav a');
    expect(result.stdout).toContain('"Services"');
    // The skip link is focus-only (off-screen, skip-link class) — not measured at all.
    expect(result.stdout).not.toContain('"Skip"');
    // The plain inline link stays exempt, listed only under the exempt heading.
    const exemptIdx = result.stdout.indexOf('Inline Text Links');
    const inlineIdx = result.stdout.indexOf('"inline"');
    expect(exemptIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeGreaterThan(exemptIdx);
  }, 30_000);

  it('--responsive-check falls back to aria-label for an icon-only button with no text', () => {
    const html = '<button aria-label="Toggle menu" style="width:40px;height:40px"></button>';
    const result = runWithStdin(html, '--html', '--responsive-check');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<button> "Toggle menu"');
    expect(result.stdout).not.toContain('""');
  }, 30_000);

  it('--responsive-check never measures display:none elements, even without --visible-only', () => {
    const html =
      '<button style="display:none;width:36px;height:36px">Menü</button>' +
      '<a href="/x" style="display:inline-block;width:20px;height:20px">go</a>';
    const result = runWithStdin(html, '--html', '--responsive-check');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"go"');
    expect(result.stdout).not.toContain('Menü');
  }, 30_000);

  it('--dismiss-consent clicks the accept button; no-hscroll + unknown --check names report explicitly', () => {
    const html =
      '<!doctype html><html lang="en"><body style="margin:0;background:#fff;color:#000">' +
      '<main><h1>Title</h1><div style="width:600px;height:10px"></div></main>' +
      '<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">' +
      '<button id="ok">Accept all</button></div>' +
      '<script>document.getElementById("ok").onclick=()=>document.getElementById("cookie-banner").remove()</script>' +
      '</body></html>';
    const result = runWithStdin(
      html,
      '--html',
      '--width',
      '375',
      '--dismiss-consent',
      '--check',
      'hidden #cookie-banner, no-hscroll, banana',
    );
    expect(result.stdout).toContain('consent: clicked button "Accept all"');
    expect(result.stdout).toContain('[PASS] hidden #cookie-banner');
    expect(result.stdout).toContain(
      '[FAIL] no-hscroll — page 600px vs viewport 375px (+225px horizontal scroll)',
    );
    expect(result.stdout).toContain('[FAIL] banana — unknown assertion — known:');
    expect(result.stdout).toContain('⚠ hscroll +225px wider than 375px viewport');
  }, 30_000);

  it('Page: overflow line names the hscroll culprit element', () => {
    // Full doc with margin:0 (not the auto-wrapped snippet, which adds a 24px body margin
    // that would shift the table's right edge) so the table's right edge is exactly 525px.
    const html =
      '<!doctype html><html><body style="margin:0">' +
      '<main><h1>Title</h1><table style="width:525px"><tr><td>Technique</td></tr></table></main>' +
      '</body></html>';
    const result = runWithStdin(html, '--html', '--width', '375');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Page: .*⚠ hscroll \+/);
    expect(result.stdout).toContain('overflow: table right=525px');
  }, 30_000);

  it('save exits promptly (no dangling --serve connection) and writes the baseline', () => {
    // Regression: with a --serve server running, save wrote the baseline and then never exited
    // (semantic-snapshot connection was only closed for launched browsers). spawnSync's timeout
    // turns a hang into status=null.
    const name = 'smoke-save-exit';
    const result = run('save', 'https://example.com', name);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Baseline "${name}" saved`);
  }, 60_000);

  it('--report alone stays text-only: no PNG at the default path (baseline for the next test)', () => {
    // Isolated LOOKSY_DIR: this checks the *default* output path (no -o/--name/--suffix),
    // so it must not collide with a real /tmp/looksy/preview.png from other usage.
    const dir = '/tmp/looksy/test-report-bare';
    rmSync(dir, { recursive: true, force: true });
    const result = spawnSync('node', [BIN, '--html', '--report'], {
      input: '<h1 style="color:#000;background:#fff">Report only</h1>',
      timeout: 30_000,
      encoding: 'utf-8',
      env: { ...process.env, LOOKSY_DIR: dir },
    });
    expect(result.status).toBe(0);
    expect(existsSync(`${dir}/preview.png`)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('--report --name saves the PNG too (explicit output request is honored, not silently dropped)', () => {
    const dir = '/tmp/looksy/test-report-name';
    rmSync(dir, { recursive: true, force: true });
    const result = spawnSync('node', [BIN, '--html', '--report', '--name', 'cart'], {
      input: '<title>Cart</title><h1 style="color:#000;background:#fff">Cart</h1>',
      timeout: 30_000,
      encoding: 'utf-8',
      env: { ...process.env, LOOKSY_DIR: dir },
    });
    expect(result.status).toBe(0);
    const pngPath = `${dir}/preview-cart.png`;
    expect(existsSync(pngPath)).toBe(true); // previously: silently never written
    expect(result.stdout).toContain(pngPath); // path is printed, not silently produced
    // --report's own text output still ran too — this isn't an either/or.
    expect(result.stdout).toContain('# Report: Cart');
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('--help → exit 0; no-args → exit 1', () => {
    const help = run('--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('looksy');

    const noArgs = spawnSync('node', [BIN], {
      timeout: 10_000,
      encoding: 'utf-8',
      // Ensure no stdin so it doesn't wait
      input: '',
    });
    expect(noArgs.status).toBe(1);
  }, 15_000);
});
