import type { Page } from 'playwright';

/**
 * Draws numbered bounding boxes on key interactive/structural elements.
 * Injects overlay divs into the page DOM before screenshot.
 * Returns a legend mapping numbers to element descriptions.
 */
export async function annotateElements(page: Page): Promise<string[]> {
  const legend = await page.evaluate(() => {
    const selectors = [
      'h1', 'h2', 'h3',
      'nav', 'header', 'footer',
      'button', 'a[href]',
      '[class*="hero"]', '[class*="cta"]', '[class*="card"]',
      '[class*="plan"]', '[class*="price"]', '[class*="feature"]',
      'section', 'form', 'input', 'img',
    ];

    const seen = new Set<Element>();
    const items: { el: Element; label: string }[] = [];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el) || items.length >= 30) continue;
        const rect = el.getBoundingClientRect();
        // Skip tiny/invisible elements
        if (rect.width < 10 || rect.height < 10) continue;
        // Skip elements fully off screen
        if (rect.bottom < 0 || rect.right < 0) continue;
        seen.add(el);

        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
        const text = (el.textContent ?? '').trim().slice(0, 40);
        items.push({ el, label: `${tag}${id}${cls} "${text}"` });
      }
    }

    const colors = [
      '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
      '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6',
    ];
    const legendLines: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const { el, label } = items[i];
      const rect = el.getBoundingClientRect();
      const color = colors[i % colors.length];
      const num = i + 1;

      // Box overlay
      const box = document.createElement('div');
      box.setAttribute('data-looksy-overlay', 'true');
      box.style.cssText = `
        position: absolute;
        top: ${rect.top + window.scrollY}px;
        left: ${rect.left + window.scrollX}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid ${color};
        pointer-events: none;
        z-index: 99999;
        box-sizing: border-box;
      `;

      // Number label
      const badge = document.createElement('div');
      badge.setAttribute('data-looksy-overlay', 'true');
      badge.textContent = String(num);
      badge.style.cssText = `
        position: absolute;
        top: ${rect.top + window.scrollY - 10}px;
        left: ${rect.left + window.scrollX - 10}px;
        width: 20px;
        height: 20px;
        background: ${color};
        color: white;
        font-size: 11px;
        font-weight: bold;
        font-family: Arial, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        pointer-events: none;
        z-index: 100000;
        line-height: 1;
      `;

      document.body.appendChild(box);
      document.body.appendChild(badge);
      legendLines.push(`#${num}: ${label}`);
    }

    return legendLines;
  });

  return legend;
}
