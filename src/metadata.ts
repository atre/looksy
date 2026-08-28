import type { Page } from 'playwright';

export interface PageMetadata {
  title: string;
  viewport: { width: number; height: number };
  pageHeight: number;
  headings: { level: number; text: string }[];
  colors: { property: string; value: string; element: string }[];
  fonts: string[];
  consoleErrors: string[];
  images: {
    src: string;
    alt: string;
    hasAlt: boolean;
    id?: string;
    className?: string;
    broken: boolean;
    pending?: boolean;
    naturalWidth: number;
    naturalHeight: number;
    displayWidth: number;
    displayHeight: number;
    format: string;
  }[];
  links: { href: string; text: string; external: boolean }[];
  elements: ElementMeta[];
}

export interface ElementMeta {
  tag: string;
  selector: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
  aboveFold?: boolean;
  parentSelector?: string;
  className?: string;
  layoutContext?: {
    flexDirection?: string;
    gridTemplateColumns?: string;
    gridTemplateRows?: string;
  };
}

const STYLE_PROPS = [
  'font-size',
  'font-weight',
  'font-family',
  'color',
  'background-color',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'display',
  'gap',
  'border-radius',
  'width',
  'height',
];

export async function extractMetadata(page: Page): Promise<PageMetadata> {
  const data = await page.evaluate((styleProps: string[]) => {
    const title = document.title;
    const pageHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;

    // Headings
    // Only screen-reader-visible headings: display:none / aria-hidden subtrees are skipped
    // (they'd produce phantom "heading skip" findings); sr-only headings are kept.
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter((el) => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"]'))
      .map((el) => ({
        level: parseInt(el.tagName[1]),
        text: (el.textContent ?? '').trim().slice(0, 100),
      }));

    // Collect unique colors from visible elements
    const colorSet = new Map<string, { property: string; value: string; element: string }>();
    const visible = document.querySelectorAll(
      'body, header, footer, main, section, nav, h1, h2, h3, p, a, button, [class*="hero"], [class*="cta"], [class*="card"], [class*="plan"], [class*="feature"]',
    );
    for (const el of visible) {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
      const label = `${tag}${cls}`;

      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        colorSet.set(`bg:${bg}`, { property: 'background-color', value: bg, element: label });
      }
      const fg = cs.color;
      if (fg) {
        colorSet.set(`fg:${fg}`, { property: 'color', value: fg, element: label });
      }
    }
    const colors = Array.from(colorSet.values()).slice(0, 20);

    // Fonts
    const fontSet = new Set<string>();
    for (const el of visible) {
      const ff = getComputedStyle(el).fontFamily;
      if (ff) fontSet.add(ff.split(',')[0].trim().replace(/['"]/g, ''));
    }
    const fonts = Array.from(fontSet);

    // Images (with optimization hints)
    const images = Array.from(document.querySelectorAll('img'))
      .slice(0, 20)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.src.slice(0, 200),
          alt: img.alt || '',
          hasAlt: img.hasAttribute('alt'),
          id: img.id || undefined,
          className: img.className ? String(img.className).split(' ')[0] : undefined,
          // Broken only when the load finished with no pixels; a lazy image that hasn't been
          // requested yet is "pending", not broken (see report.ts).
          broken: img.complete && img.naturalWidth === 0 && !!(img.currentSrc || img.src),
          pending: !img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          displayWidth: Math.round(rect.width),
          displayHeight: Math.round(rect.height),
          format: img.src.split('.').pop()?.split('?')[0]?.toLowerCase() || '',
        };
      });

    // Links
    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 30)
      .map((a) => {
        const anchor = a as HTMLAnchorElement;
        return {
          href: anchor.href.slice(0, 200),
          text: (anchor.textContent ?? '').trim().slice(0, 60),
          external: anchor.hostname !== location.hostname,
        };
      });

    // Key elements: use semantic selectors first, then fill remaining slots by area
    const semanticSelectors = [
      'body',
      'header',
      'nav',
      'main',
      'footer',
      'h1',
      'h2',
      'h3',
      'section',
      'button',
      'form',
    ];

    const seen = new Set<Element>();
    const elements: {
      tag: string;
      selector: string;
      text: string;
      rect: { x: number; y: number; width: number; height: number };
      styles: Record<string, string>;
      aboveFold: boolean;
      parentSelector: string;
      className?: string;
      layoutContext: {
        flexDirection?: string;
        gridTemplateColumns?: string;
        gridTemplateRows?: string;
      };
    }[] = [];

    // Object method pattern to avoid named functions inside evaluate
    // (esbuild keepNames wraps standalone named bindings with __name() which breaks in browser context)
    const $ = {
      sel(el: Element): string {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className ? `.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
        return `${tag}${id}${cls}`;
      },
      extract(el: Element) {
        if (seen.has(el) || elements.length >= 30) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        if (rect.bottom < 0 || rect.right < 0) return;
        seen.add(el);

        const cs = getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const prop of styleProps) {
          styles[prop] = cs.getPropertyValue(prop);
        }

        const parent = el.parentElement;
        let parentSelector = '';
        const layoutContext: {
          flexDirection?: string;
          gridTemplateColumns?: string;
          gridTemplateRows?: string;
        } = {};
        if (parent) {
          parentSelector = $.sel(parent);
          const pcs = getComputedStyle(parent);
          if (pcs.display === 'flex' || pcs.display === 'inline-flex') {
            layoutContext.flexDirection = pcs.flexDirection;
          }
          if (pcs.display === 'grid' || pcs.display === 'inline-grid') {
            layoutContext.gridTemplateColumns = pcs.gridTemplateColumns;
            layoutContext.gridTemplateRows = pcs.gridTemplateRows;
          }
        }

        const className = (el.getAttribute('class') || '').trim();
        elements.push({
          tag: el.tagName.toLowerCase(),
          selector: $.sel(el),
          text: (el.textContent ?? '').trim().slice(0, 80),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          styles,
          aboveFold: rect.top < viewportHeight,
          parentSelector,
          className: className || undefined,
          layoutContext,
        });
      },
    };

    // Phase 1: semantic selectors
    for (const s of semanticSelectors) {
      for (const el of document.querySelectorAll(s)) {
        $.extract(el);
      }
    }

    // Phase 2: fill remaining slots with largest visible elements by area
    if (elements.length < 30) {
      const candidates: { el: Element; area: number }[] = [];
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (seen.has(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) continue;
        if (rect.bottom < 0 || rect.right < 0) continue;
        if (rect.top > pageHeight) continue;
        const tag = el.tagName.toLowerCase();
        if (
          tag === 'script' ||
          tag === 'style' ||
          tag === 'link' ||
          tag === 'meta' ||
          tag === 'head' ||
          tag === 'html'
        )
          continue;
        candidates.push({ el, area: rect.width * rect.height });
      }
      candidates.sort((a, b) => b.area - a.area);
      for (const c of candidates.slice(0, 30 - elements.length)) {
        $.extract(c.el);
      }
    }

    return { title, pageHeight, headings, colors, fonts, images, links, elements };
  }, STYLE_PROPS);

  return {
    ...data,
    viewport: { width: 0, height: 0 }, // filled by caller
    consoleErrors: [], // filled by caller from screenshot.ts listener
  };
}

export interface FormatOptions {
  compact?: boolean;
  tailwind?: boolean;
}

/** Tailwind utility prefixes — used to classify class names into rough categories. */
const TW_PREFIXES: Array<[RegExp, string]> = [
  [/^(p|m|px|py|mx|my|mt|mr|mb|ml|pt|pr|pb|pl|space|gap)-/, 'spacing'],
  [/^(w|h|min-w|min-h|max-w|max-h|size)-/, 'sizing'],
  [
    /^(text|bg|border|ring|outline|shadow|fill|stroke|from|to|via|placeholder|caret|accent|decoration|divide)-/,
    'colors',
  ],
  [/^(flex|grid|items|justify|content|self|place|order|col|row|basis|grow|shrink)-?/, 'layout'],
  [/^(font|leading|tracking|whitespace|truncate|line-clamp|list)-?/, 'typography'],
  [/^(rounded|border|ring|outline)(-|$)/, 'borders'],
  [
    /^(opacity|z|cursor|select|pointer|overflow|object|aspect|isolate|inset|top|right|bottom|left)-?/,
    'misc',
  ],
  [
    /^(translate|rotate|scale|skew|origin|transition|duration|delay|ease|animate|transform)/,
    'animation',
  ],
];

const TW_PURE_UTILITIES = new Set([
  'flex',
  'grid',
  'block',
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'hidden',
  'table',
  'contents',
  'absolute',
  'relative',
  'fixed',
  'sticky',
  'static',
  'truncate',
  'sr-only',
  'not-sr-only',
  'isolate',
  'visible',
  'invisible',
  'collapse',
  'container',
  'antialiased',
  'subpixel-antialiased',
  'italic',
  'not-italic',
  'underline',
  'overline',
  'line-through',
  'no-underline',
  'uppercase',
  'lowercase',
  'capitalize',
  'normal-case',
]);

const TW_VARIANT_PREFIX =
  /^(sm|md|lg|xl|2xl|hover|focus|active|disabled|group-hover|dark|first|last|odd|even|focus-visible|focus-within|motion-safe|motion-reduce|print):/;

/** Classify a class name as a Tailwind utility category, or null if it doesn't look like one. */
function classifyTailwind(cls: string): string | null {
  if (!cls) return null;
  let core = cls;
  while (TW_VARIANT_PREFIX.test(core)) core = core.replace(TW_VARIANT_PREFIX, '');
  if (TW_PURE_UTILITIES.has(core)) return 'layout';
  for (const [pattern, category] of TW_PREFIXES) {
    if (pattern.test(core)) return category;
  }
  return null;
}

/** Group all Tailwind utilities used across elements by category, with frequency. */
function summarizeTailwind(elements: ElementMeta[]): Map<string, Map<string, number>> {
  const byCategory = new Map<string, Map<string, number>>();
  for (const el of elements) {
    if (!el.className) continue;
    for (const cls of el.className.split(/\s+/)) {
      const cat = classifyTailwind(cls);
      if (!cat) continue;
      if (!byCategory.has(cat)) byCategory.set(cat, new Map());
      const bucket = byCategory.get(cat)!;
      bucket.set(cls, (bucket.get(cls) || 0) + 1);
    }
  }
  return byCategory;
}

/** Filter predicate for "relevant" computed styles — drops defaults, individual box props, and (in compact) font-family. */
function isRelevantStyle(key: string, v: string, compact: boolean): boolean {
  if (!v || v === 'normal' || v === 'none' || v === 'auto' || v === '0px' || v === 'rgb(0, 0, 0)')
    return false;
  if (key.match(/^(padding|margin)-(top|right|bottom|left)$/)) return false;
  if (compact && key === 'font-family') return false;
  return true;
}

function collapseBoxProp(styles: Record<string, string>, prefix: string): string | null {
  const t = styles[`${prefix}-top`];
  const r = styles[`${prefix}-right`];
  const b = styles[`${prefix}-bottom`];
  const l = styles[`${prefix}-left`];
  if (!t && !r && !b && !l) return null;
  const isDefault = (v: string) => !v || v === '0px' || v === 'auto' || v === 'normal';
  if (isDefault(t) && isDefault(r) && isDefault(b) && isDefault(l)) return null;
  if (t === r && r === b && b === l) return `${prefix}: ${t}`;
  if (t === b && r === l) return `${prefix}: ${t} ${r}`;
  return `${prefix}: ${t} ${r} ${b} ${l}`;
}

export function formatMetadata(meta: PageMetadata, opts: FormatOptions = {}): string {
  const lines: string[] = [];
  const compact = opts.compact ?? false;
  const tailwind = opts.tailwind ?? false;

  lines.push(`# Page Metadata: ${meta.title}`);
  lines.push('');
  lines.push(
    `**Viewport:** ${meta.viewport.width}x${meta.viewport.height} | **Page height:** ${meta.pageHeight}px`,
  );
  lines.push('');

  // Console errors (always show — these are important)
  if (meta.consoleErrors.length > 0) {
    lines.push(compact ? '## Errors' : '## Console Errors');
    for (const err of meta.consoleErrors) {
      lines.push(`- ${compact ? err : `\`${err}\``}`);
    }
    lines.push('');
  }

  // Heading hierarchy
  if (meta.headings.length > 0) {
    lines.push('## Heading Hierarchy');
    for (const h of meta.headings) {
      lines.push(`${'  '.repeat(h.level - 1)}- H${h.level}: ${h.text}`);
    }
    lines.push('');
  }

  // Color palette
  if (meta.colors.length > 0) {
    if (compact) {
      // Convert rgb() to hex, group by role, limit to top 8
      const toHex = (rgb: string) => {
        const m = rgb.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return rgb;
        return (
          '#' +
          [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
            .map((c) => c.toString(16).padStart(2, '0'))
            .join('')
        );
      };
      const bgs = meta.colors.filter((c) => c.property === 'background-color').slice(0, 4);
      const fgs = meta.colors.filter((c) => c.property === 'color').slice(0, 4);
      const parts: string[] = [];
      if (bgs.length > 0)
        parts.push(`bg: ${bgs.map((c) => `${c.element}=${toHex(c.value)}`).join(', ')}`);
      if (fgs.length > 0)
        parts.push(`text: ${fgs.map((c) => `${c.element}=${toHex(c.value)}`).join(', ')}`);
      lines.push(`## Colors: ${parts.join(' | ')}`);
    } else {
      lines.push('## Color Palette');
      lines.push('| Element | Property | Value |');
      lines.push('|---------|----------|-------|');
      for (const c of meta.colors) {
        lines.push(`| ${c.element} | ${c.property} | \`${c.value}\` |`);
      }
    }
    lines.push('');
  }

  // Fonts
  if (meta.fonts.length > 0) {
    lines.push(`## Fonts: ${meta.fonts.join(', ')}`);
    lines.push('');
  }

  // Tailwind utility profile
  if (tailwind) {
    const tw = summarizeTailwind(meta.elements);
    if (tw.size > 0) {
      lines.push('## Tailwind Utilities');
      const order = [
        'layout',
        'spacing',
        'sizing',
        'colors',
        'typography',
        'borders',
        'animation',
        'misc',
      ];
      for (const cat of order) {
        const bucket = tw.get(cat);
        if (!bucket || bucket.size === 0) continue;
        const top = [...bucket.entries()].sort((a, b) => b[1] - a[1]).slice(0, compact ? 6 : 12);
        const items = top.map(([cls, n]) => (n > 1 ? `${cls} (${n})` : cls)).join(', ');
        lines.push(`- **${cat}**: ${items}`);
      }
      lines.push('');
    } else {
      lines.push('## Tailwind Utilities: none detected');
      lines.push('');
    }
  }

  // Broken images only (compact drops non-broken entirely; full mode already only showed broken)
  const broken = meta.images.filter((i) => i.broken);
  if (broken.length > 0) {
    lines.push('## Broken Images');
    for (const img of broken) {
      lines.push(`- ${img.src} (alt: "${img.alt}")`);
    }
    lines.push('');
  }

  // Image optimization hints
  const oversized = meta.images.filter(
    (i) => !i.broken && i.naturalWidth > 0 && i.naturalWidth > i.displayWidth * 2,
  );
  const legacyFormat = meta.images.filter(
    (i) => !i.broken && ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(i.format),
  );
  if (oversized.length > 0 || legacyFormat.length > 0) {
    lines.push(compact ? '## Image Optimization' : '## Image Optimization Hints');
    if (oversized.length > 0) {
      for (const img of oversized) {
        const ratio = (img.naturalWidth / Math.max(img.displayWidth, 1)).toFixed(1);
        lines.push(
          `- ${img.src.split('/').pop()?.split('?')[0] || 'image'}: ${img.naturalWidth}x${img.naturalHeight} displayed at ${img.displayWidth}x${img.displayHeight} (${ratio}x oversized)`,
        );
      }
    }
    if (!compact && legacyFormat.length > 0) {
      lines.push(`- ${legacyFormat.length} image(s) could use modern formats (WebP/AVIF)`);
    }
    lines.push('');
  }

  // Key elements with styles
  if (meta.elements.length > 0) {
    lines.push(compact ? '## Elements' : '## Key Elements (computed styles)');
    lines.push('');

    // In compact mode, group by fold
    if (compact) {
      const above = meta.elements.filter((el) => el.aboveFold);
      const below = meta.elements.filter((el) => !el.aboveFold);
      if (above.length > 0) {
        lines.push(`**Above fold:** ${above.map((el) => el.selector).join(', ')}`);
      }
      if (below.length > 0) {
        lines.push(`**Below fold:** ${below.map((el) => el.selector).join(', ')}`);
      }
      lines.push('');
    }

    for (const el of meta.elements) {
      const pos = `${el.rect.x},${el.rect.y} ${el.rect.width}x${el.rect.height}`;
      const fold = el.aboveFold ? ' [above-fold]' : '';

      if (compact) {
        // Single-line per element with collapsed shorthand
        const parts: string[] = [];
        const relevantStyles = Object.entries(el.styles).filter(([k, v]) =>
          isRelevantStyle(k, v, true),
        );
        for (const [prop, val] of relevantStyles) {
          parts.push(`${prop}=${val}`);
        }
        // Collapsed padding/margin
        const padding = collapseBoxProp(el.styles, 'padding');
        if (padding) parts.push(padding);
        const margin = collapseBoxProp(el.styles, 'margin');
        if (margin) parts.push(margin);
        // Layout context
        if (el.layoutContext?.flexDirection)
          parts.push(`parent-flex=${el.layoutContext.flexDirection}`);
        if (el.layoutContext?.gridTemplateColumns)
          parts.push(`parent-grid-cols=${el.layoutContext.gridTemplateColumns}`);

        const text = el.text ? ` "${el.text.slice(0, 40)}"` : '';
        lines.push(`- \`${el.selector}\` [${pos}]${text} — ${parts.join(', ')}`);
      } else {
        // Full mode with code blocks
        lines.push(`### \`${el.selector}\` [${pos}]${fold}`);
        if (el.text) {
          lines.push(`> ${el.text.slice(0, 60)}`);
        }
        if (el.parentSelector) {
          lines.push(`Parent: \`${el.parentSelector}\``);
        }
        if (el.layoutContext?.flexDirection) {
          lines.push(`Layout: flex (${el.layoutContext.flexDirection})`);
        }
        if (el.layoutContext?.gridTemplateColumns) {
          lines.push(`Layout: grid (cols: ${el.layoutContext.gridTemplateColumns})`);
        }

        const relevantStyles = Object.entries(el.styles).filter(([k, v]) =>
          isRelevantStyle(k, v, false),
        );
        const padding = collapseBoxProp(el.styles, 'padding');
        const margin = collapseBoxProp(el.styles, 'margin');
        const allStyles = [...relevantStyles.map(([p, v]) => `${p}: ${v}`)];
        if (padding) allStyles.push(padding);
        if (margin) allStyles.push(margin);

        if (allStyles.length > 0) {
          lines.push('```');
          for (const s of allStyles) {
            lines.push(s);
          }
          lines.push('```');
        }
        lines.push('');
      }
    }
    if (compact) lines.push('');
  }

  return lines.join('\n');
}
