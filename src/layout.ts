import type { Page } from 'playwright';

/**
 * Inject a visual overlay highlighting all flex and grid containers.
 * Shows: container outlines (colored by type), direction, gap, justify/align labels.
 * Uses CSS outline (not border) to avoid layout shifts.
 */
export async function injectLayoutOverlay(page: Page): Promise<string[]> {
  // Returns legend lines like: ["1. div.hero — flex row, gap: 16px, justify: center"]
  const legend = await page.evaluate(() => {
    const MAX_CONTAINERS = 30;

    interface ContainerInfo {
      tag: string;
      cls: string;
      display: 'flex' | 'grid';
      direction: string;
      gap: string;
      justifyContent: string;
      alignItems: string;
      width: number;
      height: number;
      top: number;
      left: number;
    }

    const containers: ContainerInfo[] = [];
    const seen = new Set<Element>();
    const all = document.querySelectorAll('*');

    for (const el of all) {
      if (seen.has(el) || containers.length >= MAX_CONTAINERS) break;
      if (el === document.body || el === document.documentElement) continue;

      const style = getComputedStyle(el);
      const display = style.display;

      if (display !== 'flex' && display !== 'inline-flex' &&
          display !== 'grid' && display !== 'inline-grid') continue;

      const rect = el.getBoundingClientRect();
      // Skip tiny/invisible elements
      if (rect.width < 10 || rect.height < 10) continue;
      // Skip elements fully off screen (above viewport)
      if (rect.bottom < 0 || rect.right < 0) continue;

      seen.add(el);

      const tag = el.tagName.toLowerCase();
      const rawCls = typeof el.className === 'string' ? el.className.trim() : '';
      const firstCls = rawCls.split(/\s+/)[0] ?? '';
      const cls = firstCls ? `.${firstCls}` : '';

      const isFlex = display === 'flex' || display === 'inline-flex';
      const isGrid = display === 'grid' || display === 'inline-grid';

      let direction = '';
      if (isFlex) {
        direction = style.flexDirection || 'row';
      } else if (isGrid) {
        const cols = style.gridTemplateColumns;
        const rows = style.gridTemplateRows;
        // Summarise column count when possible
        if (cols && cols !== 'none') {
          const colCount = cols.trim().split(/\s+(?=\[|\d|auto|minmax|repeat|fr|%)/).length;
          direction = `${colCount}-col`;
        } else {
          direction = rows && rows !== 'none' ? 'rows' : '';
        }
      }

      const gap = style.gap && style.gap !== '0px' && style.gap !== 'normal'
        ? style.gap
        : (style.rowGap !== '0px' && style.rowGap !== 'normal' ? style.rowGap : '');

      containers.push({
        tag,
        cls,
        display: isFlex ? 'flex' : 'grid',
        direction,
        gap: gap || '0',
        justifyContent: style.justifyContent || 'normal',
        alignItems: style.alignItems || 'normal',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
      });
    }

    // --- Inject overlay style ---
    const style = document.createElement('style');
    style.setAttribute('data-looksy-layout', 'true');
    style.textContent = `
      [data-looksy-layout-outline] {
        outline-offset: -2px !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);

    // --- Apply outlines directly to matched elements ---
    const matchedEls = Array.from(seen);
    for (let i = 0; i < matchedEls.length; i++) {
      const el = matchedEls[i] as HTMLElement;
      const info = containers[i];
      if (!info) continue;
      const color = info.display === 'flex' ? '#FF6B6B' : '#4ECDC4';
      el.setAttribute('data-looksy-layout-outline', 'true');
      el.style.outline = `2px dashed ${color}`;
      el.style.outlineOffset = '-2px';
    }

    // --- Inject label overlays ---
    const legendLines: string[] = [];

    for (let i = 0; i < containers.length; i++) {
      const info = containers[i];
      const num = i + 1;
      const color = info.display === 'flex' ? '#FF6B6B' : '#4ECDC4';

      // Build a compact descriptor for the label
      const parts: string[] = [info.display];
      if (info.direction) parts.push(info.direction);
      if (info.gap && info.gap !== '0' && info.gap !== '0px') parts.push(`gap:${info.gap}`);

      const labelText = `${num} ${parts.join(' ')}`;

      const label = document.createElement('div');
      label.setAttribute('data-looksy-layout', 'true');
      label.textContent = labelText;
      label.style.cssText = `
        position: absolute;
        top: ${info.top}px;
        left: ${info.left}px;
        background: ${color}cc;
        color: #fff;
        font-size: 10px;
        font-family: monospace, Arial, sans-serif;
        font-weight: bold;
        line-height: 1.2;
        padding: 1px 4px;
        border-radius: 2px;
        pointer-events: none;
        z-index: 100000;
        white-space: nowrap;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      `;

      document.body.appendChild(label);

      // Build legend line
      const selectorStr = `${info.tag}${info.cls}`;
      const descParts: string[] = [`${info.display} ${info.direction}`.trim()];
      if (info.gap && info.gap !== '0' && info.gap !== '0px') {
        descParts.push(`gap: ${info.gap}`);
      }
      if (info.justifyContent && info.justifyContent !== 'normal') {
        descParts.push(`justify: ${info.justifyContent}`);
      }
      if (info.alignItems && info.alignItems !== 'normal') {
        descParts.push(`align: ${info.alignItems}`);
      }
      descParts.push(`${info.width}×${info.height}px`);

      legendLines.push(`${num}. ${selectorStr} — ${descParts.join(', ')}`);
    }

    return legendLines;
  });

  return legend;
}
