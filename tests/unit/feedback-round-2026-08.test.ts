import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarize } from '../../src/analysis-summary.js';
import { formatSchema } from '../../src/schema.js';
import { formatSuggestions } from '../../src/suggest.js';
import { formatImages, imageOffenders } from '../../src/images.js';
import { formatCompression } from '../../src/compression.js';
import { formatCacheAudit } from '../../src/cache-audit.js';
import { formatBundles } from '../../src/bundles.js';
import { formatPageLine, formatOverflowFlag } from '../../src/cli-output.js';
import { formatResponsiveCheck } from '../../src/responsive-check.js';
import {
  validateTheme,
  formatThemeResults,
  formatRatio,
  loadThemeConfig,
  loadThemeFromCss,
} from '../../src/validate-theme.js';

describe('seo summary: full title', () => {
  it('never truncates the title and appends its length', () => {
    const title = 'Blaubeer-Samt Kissenbezug & Tischdeckenschutz für Ihr Zuhause';
    const out = summarize('seo', { title, schemaTypes: [], og: {} })!;
    expect(out).toContain(`"${title}" (${title.length} chars)`);
  });
});

describe('schema: Product recommended-field coverage', () => {
  const data = {
    blockCount: 2,
    items: [
      {
        type: 'Product',
        properties: {
          recommended: '9/11 recommended fields (missing brand, offers.shippingDetails)',
        },
        issues: ['Product missing recommended: brand, offers.shippingDetails'],
      },
      { type: 'BreadcrumbList', properties: { items: '3' }, issues: [] },
    ],
  };
  it('compact output carries the coverage line', () => {
    const out = formatSchema(data as any, { compact: true });
    expect(out).toContain('## Schema (2): Product, BreadcrumbList | 1 issues');
    expect(out).toContain(
      '- Product: 9/11 recommended fields (missing brand, offers.shippingDetails)',
    );
  });
  it('stdout summary appends Product coverage', () => {
    expect(summarize('schema', data)).toContain('Product 9/11 recommended fields (missing brand');
  });
});

describe('suggestions name the element', () => {
  it('lists broken image srcs, missing-alt srcs, and heading skip pairs', () => {
    const out = formatSuggestions({
      brokenImages: 2,
      brokenImageSrcs: ['hero.webp', 'card-3.jpg'],
      missingAlt: 1,
      missingAltSrcs: ['logo.svg'],
      headingSkips: 1,
      headingSkipDetails: ['h1 "Alle Produkte" → h3 "Sofa"'],
    });
    expect(out).toContain('2 broken images (hero.webp, card-3.jpg)');
    expect(out).toContain('1 image missing alt (logo.svg)');
    expect(out).toContain('1 heading level skip (h1 "Alle Produkte" → h3 "Sofa")');
  });
  it('maps the named a11y heading-skip issue to a fix that keeps the names', () => {
    const out = formatSuggestions({ a11yIssues: ['Heading level skipped: h1 "Home" → h3 "FAQ"'] });
    expect(out).toContain('H1→H3 (h1 "Home" → h3 "FAQ")');
  });
});

describe('--speed compact sections list offenders', () => {
  it('images: names the files behind each issue, capped by limit', () => {
    const img = (name: string, o: Partial<any> = {}) => ({
      src: name,
      name,
      renderedWidth: 100,
      renderedHeight: 100,
      naturalWidth: 100,
      naturalHeight: 100,
      format: 'PNG',
      transferSize: 100,
      loading: 'auto',
      aboveFold: true,
      oversized: false,
      missingDimensions: false,
      isNextImage: true,
      isSvg: false,
      ...o,
    });
    const data = {
      images: [
        img('a.png', { oversized: true }),
        img('b.png', { oversized: true }),
        img('c.png', { oversized: true }),
        img('d.png', { loading: 'lazy' }),
      ],
      totalCount: 4,
      totalTransferSize: 400,
      issues: [{ severity: 'high', message: '3 image(s) served larger than rendered (>2x)' }],
    };
    expect(imageOffenders(data as any).map((g) => g.label)).toEqual([
      'lazy above fold',
      'oversized (>2x rendered)',
    ]);
    const out = formatImages(data as any, { compact: true, limit: 2 });
    expect(out).toContain('- oversized (>2x rendered) (3): a.png, b.png … and 1 more');
    expect(out).toContain('- lazy above fold (1): d.png');
  });
  it('compression: names uncompressed resources largest first', () => {
    const e = (name: string, encoding: string, decodedSize: number) => ({
      name,
      type: 'script',
      encoding,
      transferSize: decodedSize,
      decodedSize,
      ratio: 1,
    });
    const out = formatCompression(
      {
        entries: [e('small.js', 'none', 2048), e('big.js', 'none', 204800), e('ok.js', 'br', 5000)],
        uncompressedCount: 2,
        uncompressedSize: 206848,
        brotliCount: 1,
        gzipCount: 0,
        noneCount: 2,
        potentialSavings: 150000,
      } as any,
      { compact: true },
    );
    expect(out).toContain('- uncompressed (2): big.js 200.0 KB, small.js 2.0 KB');
  });
  it('cache: groups offenders per issue', () => {
    const c = (name: string, issue: string | null, transferSize = 1) => ({
      name,
      url: name,
      type: 'img',
      transferSize,
      cacheControl: 'x',
      encoding: 'none',
      ttl: null,
      issue,
    });
    const out = formatCacheAudit(
      {
        entries: [
          c('a.png', 'static asset not cached', 5),
          c('b.png', 'static asset not cached', 9),
          c('x.js', null),
        ],
        totalResources: 3,
        noCacheCount: 2,
        shortTtlCount: 0,
        immutableCount: 0,
        issues: [],
      } as any,
      { compact: true },
    );
    expect(out).toContain('- static asset not cached (2): b.png, a.png');
  });
  it('bundles: names large chunks', () => {
    const b = {
      name: 'vendor.js',
      url: '/vendor.js',
      transferSize: 120000,
      decodedSize: 400000,
      duration: 10,
      category: 'vendor' as const,
    };
    const out = formatBundles(
      {
        entries: [b],
        totalTransferSize: 120000,
        totalDecodedSize: 400000,
        largeChunks: [b],
        categoryBreakdown: [],
      },
      { compact: true },
    );
    expect(out).toContain('- large: vendor.js 117.2 KB');
  });
});

describe('Page line flags horizontal overflow', () => {
  it('appends the overflow amount when the document is wider than the viewport', () => {
    const line = formatPageLine({
      imagePath: 'x',
      pageInfo: { width: 396, height: 3196, title: 'PLP', viewportWidth: 375 },
    });
    expect(line).toBe('Page: 396x3196px ⚠ hscroll +21px wider than 375px viewport "PLP"');
  });
  it('is silent when the page fits', () => {
    const line = formatPageLine({
      imagePath: 'x',
      pageInfo: { width: 375, height: 100, title: '', viewportWidth: 375 },
    });
    expect(line).toBe('Page: 375x100px');
  });
});

describe('formatOverflowFlag', () => {
  it('flags overflow with the standard wording', () => {
    expect(formatOverflowFlag(396, 375)).toBe(' ⚠ hscroll +21px wider than 375px viewport');
  });
  it('is empty when the page fits', () => {
    expect(formatOverflowFlag(375, 375)).toBe('');
  });
});

describe('responsive-check compact list honours --limit', () => {
  const t = (text: string) => ({
    tag: 'button',
    text,
    className: '',
    width: 20,
    height: 20,
    inlineExempt: false,
  });
  const result = {
    targetSize: 44,
    totalIssues: 1,
    breakpoints: [
      {
        width: 375,
        label: 'Mobile',
        issues: [{ severity: 'MEDIUM', message: '7 controls smaller than 44px minimum' }],
        hasHorizontalOverflow: false,
        smallTouchTargets: 7,
        tinyText: 0,
        pageHeight: 100,
        touchTargetDetails: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(t),
        tinyTextDetails: [],
      },
    ],
  } as any;
  it('defaults to 5 with a hint', () => {
    const out = formatResponsiveCheck(result, { compact: true });
    expect(out).toContain('… and 2 more (raise with --limit N)');
  });
  it('lists everything at a higher limit', () => {
    const out = formatResponsiveCheck(result, { compact: true, limit: 10 });
    expect(out).not.toContain('more');
    expect(out).toContain('"g"');
  });
  it('summary line reports overflow amount and control counts per breakpoint', () => {
    const s = summarize('responsiveCheck', {
      targetSize: 44,
      breakpoints: [
        {
          width: 375,
          hasHorizontalOverflow: true,
          scrollWidth: 396,
          smallTouchTargets: 3,
          tinyText: 0,
        },
        { width: 1440, hasHorizontalOverflow: false, smallTouchTargets: 0, tinyText: 0 },
      ],
    });
    expect(s).toBe('responsive: 375px hscroll +21px, 3 controls < 44px | 1440px ok');
  });
});

describe('validate-theme: labels, borderline, @theme', () => {
  it('shows 3 decimals near a threshold and marks borderline', () => {
    expect(formatRatio(4.499)).toBe('4.499');
    expect(formatRatio(4.4)).toBe('4.40');
    const [r] = validateTheme([{ fg: '#767676', bg: '#ffffff', label: 'success' }]);
    expect(r.borderline).toBe(true);
    const out = formatThemeResults([r]);
    expect(out).toContain('(borderline)');
    expect(out).not.toMatch(/4\.50:1 \*\*FAIL\*\*/);
  });
  it('accepts "name" as the pair label', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-theme-'));
    const p = join(dir, 'pairs.json');
    writeFileSync(
      p,
      JSON.stringify({
        pairs: [
          { fg: '#000', bg: '#fff', name: 'body' },
          { fg: '#111', bg: '#fff' },
        ],
      }),
    );
    const pairs = loadThemeConfig(p);
    expect(pairs[0].label).toBe('body');
    expect(pairs[1].label).toBe('Pair 2');
  });
  it('parses Tailwind v4 @theme --color-* vars and pairs X / X-foreground', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-theme-'));
    const p = join(dir, 'globals.css');
    writeFileSync(
      p,
      `@theme {\n  --color-primary: #1a1a2e;\n  --color-primary-foreground: #ffffff;\n  --font-sans: Inter;\n}\n`,
    );
    const pairs = loadThemeFromCss(p);
    expect(pairs).toEqual([{ fg: '#ffffff', bg: '#1a1a2e', label: '--primary' }]);
  });
});

describe('browser lifecycle guard', () => {
  it('no source file gates browser.close() on `owned` (close() only disconnects a --serve browser; skipping it hangs the CLI)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const offenders: string[] = [];
    for (const f of readdirSync('src')) {
      if (!f.endsWith('.ts')) continue;
      const src = readFileSync(`src/${f}`, 'utf-8');
      if (/if\s*\(\s*\w*[oO]wned\s*(&&[^)]*)?\)\s*await\s+\w+\.close\(\)/.test(src))
        offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe('validate-theme --text-on cross-product', () => {
  const css = `:root { --background: #fff; --foreground: #111; --muted: #f4f4f5; --muted-foreground: #767676; --info: #5A8EC4; }`;
  it('crosses each fg token with every other token by default, skipping fg==bg', async () => {
    const { extractCssColors, crossPairCssColors } = await import('../../src/validate-theme.js');
    const pairs = crossPairCssColors(extractCssColors(css), { textOn: ['foreground'] });
    expect(pairs.map((p) => p.label)).toEqual([
      '--foreground on --background',
      '--foreground on --muted',
      '--foreground on --muted-foreground',
      '--foreground on --info',
    ]);
  });
  it('restricts to --bg-tokens and accepts -- / color- prefixes', async () => {
    const { extractCssColors, crossPairCssColors } = await import('../../src/validate-theme.js');
    const pairs = crossPairCssColors(extractCssColors(css), {
      textOn: ['--muted-foreground'],
      bgTokens: ['color-muted', 'background'],
    });
    expect(pairs.map((p) => p.label)).toEqual([
      '--muted-foreground on --muted',
      '--muted-foreground on --background',
    ]);
  });
  it('names unknown tokens and lists what is available', async () => {
    const { extractCssColors, crossPairCssColors } = await import('../../src/validate-theme.js');
    expect(() => crossPairCssColors(extractCssColors(css), { textOn: ['nope'] })).toThrow(
      /--nope.*Available: --background/,
    );
  });
});
