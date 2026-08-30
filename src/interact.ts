import type { Page } from 'playwright';

interface Action {
  type: 'click' | 'scroll' | 'scroll-to' | 'type' | 'wait' | 'hover' | 'tap' | 'swipe';
  target?: string; // CSS selector (for click, type, hover)
  value?: string; // text to type, scroll px, wait ms
  direction?: 'left' | 'right' | 'up' | 'down';
  distance?: number;
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
      case 'tap':
        actions.push({ type, target: rest });
        break;
      case 'swipe': {
        // swipe:<dir>[=px] | swipe:<selector>=<dir>[=px]  (selectors containing "=" unsupported)
        const DIRS = ['left', 'right', 'up', 'down'];
        const parts = rest.split('=');
        let target: string | undefined;
        let dir: string;
        let px: string | undefined;
        if (DIRS.includes(parts[0])) {
          dir = parts[0];
          px = parts[1];
        } else {
          target = parts[0];
          dir = parts[1];
          px = parts[2];
        }
        if (!DIRS.includes(dir)) break;
        const a: Action = { type, direction: dir as Action['direction'] };
        if (target) a.target = target;
        if (px !== undefined && /^\d+$/.test(px)) a.distance = parseInt(px, 10);
        actions.push(a);
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
      case 'tap':
        if (action.target) {
          try {
            await page.tap(action.target, { timeout: 5000 });
          } catch (err: any) {
            if (/does not support tap/.test(err?.message ?? '')) {
              throw new Error(
                `tap:${action.target} needs a touch context — use --mobile, --tablet or --device`,
              );
            }
            throw err;
          }
        }
        break;
      case 'swipe': {
        const dist = action.distance ?? 200;
        let x: number;
        let y: number;
        if (action.target) {
          const box = await page.locator(action.target).first().boundingBox({ timeout: 5000 });
          if (!box) throw new Error(`swipe: "${action.target}" not found or not visible`);
          x = box.x + box.width / 2;
          y = box.y + box.height / 2;
        } else {
          const vp = page.viewportSize() ?? { width: 1280, height: 800 };
          x = vp.width / 2;
          y = vp.height / 2;
        }
        const dx = action.direction === 'left' ? -dist : action.direction === 'right' ? dist : 0;
        const dy = action.direction === 'up' ? -dist : action.direction === 'down' ? dist : 0;
        // CDP touch events reach touchstart/touchmove handlers and native scroll containers alike; no hasTouch needed (Chromium-only, as is looksy).
        const cdp = await page.context().newCDPSession(page);
        try {
          const STEPS = 12;
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          });
          for (let i = 1; i <= STEPS; i++) {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: x + (dx * i) / STEPS, y: y + (dy * i) / STEPS }],
            });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
          await cdp.detach();
        }
        break;
      }
    }
  }
}
