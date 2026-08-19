import type { Page } from 'playwright';

interface Action {
  type: 'click' | 'scroll' | 'scroll-to' | 'type' | 'wait' | 'hover';
  target?: string;  // CSS selector (for click, type, hover)
  value?: string;   // text to type, scroll px, wait ms
}

/**
 * Parse an interaction string into actions.
 * Format: "click:.btn,wait:500,scroll:1000,type:.input=hello,hover:.menu"
 */
export function parseInteractions(input: string): Action[] {
  const actions: Action[] = [];

  for (const part of input.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const type = trimmed.slice(0, colonIdx) as Action['type'];
    const rest = trimmed.slice(colonIdx + 1);

    switch (type) {
      case 'click':
      case 'hover':
      case 'scroll-to':
        actions.push({ type, target: rest });
        break;
      case 'scroll':
        actions.push({ type, value: rest });
        break;
      case 'wait':
        actions.push({ type, value: rest });
        break;
      case 'type': {
        // format: type:.selector=text
        const eqIdx = rest.indexOf('=');
        if (eqIdx !== -1) {
          actions.push({ type, target: rest.slice(0, eqIdx), value: rest.slice(eqIdx + 1) });
        }
        break;
      }
    }
  }

  return actions;
}

/**
 * Execute a sequence of interactions on the page.
 */
export async function executeInteractions(page: Page, actions: Action[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'click':
        if (action.target) {
          await page.click(action.target, { timeout: 5000 });
        }
        break;
      case 'hover':
        if (action.target) {
          await page.hover(action.target, { timeout: 5000 });
        }
        break;
      case 'scroll': {
        const px = parseInt(action.value ?? '0', 10);
        await page.evaluate((scrollY) => window.scrollBy(0, scrollY), px);
        break;
      }
      case 'wait': {
        const ms = parseInt(action.value ?? '0', 10);
        await page.waitForTimeout(ms);
        break;
      }
      case 'scroll-to':
        if (action.target) {
          const el = await page.$(action.target);
          if (el) {
            await el.scrollIntoViewIfNeeded();
            await page.waitForTimeout(100);
          }
        }
        break;
      case 'type':
        if (action.target && action.value !== undefined) {
          await page.fill(action.target, action.value, { timeout: 5000 });
        }
        break;
    }
  }
}
