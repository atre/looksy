import type { BrowserContext, Frame, Page } from 'playwright';

/**
 * Pre-capture page preparation shared by every capture path that opens its own
 * context (main screenshot, --responsive-check breakpoints, sweep): request cookies,
 * localStorage seeding, and cookie/consent-banner dismissal.
 *
 * Consent overlays were the #1 dogfooding friction: a CMP banner covered ~35% of every
 * mobile fold and its own buttons leaked into contrast counts. Three levers, cheapest first:
 *   --cookie k=v            the site's own "consent given" cookie
 *   --local-storage k=v     same, for CMPs that persist consent in localStorage
 *   --dismiss-consent       click a known accept/dismiss control, then hide known CMP roots
 */
export interface PagePrepOptions {
  /** "name=value; name2=value2" — cookies set on the target hostname before navigation. */
  cookie?: string;
  /** "key=value; key2=value2" — localStorage entries seeded before any page script runs. */
  localStorage?: string;
  /** Click a known consent-accept control after load and hide known CMP containers. */
  dismissConsent?: boolean;
}

/** Parse "a=1; b=2" (also accepts newline-separated) into ordered pairs. Values may contain '='. */
export function parseKeyValuePairs(
  input: string | undefined,
): Array<{ name: string; value: string }> {
  if (!input) return [];
  return input
    .split(/[;\n]/)
    .map((c) => c.trim())
    .filter((c) => c.includes('='))
    .map((c) => {
      const eq = c.indexOf('=');
      return { name: c.slice(0, eq).trim(), value: c.slice(eq + 1).trim() };
    })
    .filter((p) => p.name.length > 0);
}

/** Playwright cookie records for `--cookie`, scoped to the URL's hostname (path=/). */
export function cookiesForUrl(
  cookie: string | undefined,
  url: string,
): Array<{ name: string; value: string; domain: string; path: string }> {
  let hostname = 'localhost';
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* use default */
  }
  return parseKeyValuePairs(cookie).map((p) => ({ ...p, domain: hostname, path: '/' }));
}

/** Apply cookies + localStorage seeding to a fresh context, before the first navigation. */
export async function prepareContext(
  context: BrowserContext,
  url: string,
  opts: PagePrepOptions,
): Promise<void> {
  const cookies = cookiesForUrl(opts.cookie, url);
  if (cookies.length > 0) await context.addCookies(cookies);

  const items = parseKeyValuePairs(opts.localStorage);
  if (items.length > 0) {
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      /* set on every origin */
    }
    // Init scripts run before any page script on every document; scope to the target origin
    // so third-party iframes (which have their own storage) are left alone.
    await context.addInitScript(
      (args: { origin: string; items: Array<{ name: string; value: string }> }) => {
        try {
          if (args.origin && location.origin !== args.origin) return;
          for (const it of args.items) localStorage.setItem(it.name, it.value);
        } catch {
          /* storage may be disabled (sandboxed frames, opaque origins) */
        }
      },
      { origin, items },
    );
  }
}

/**
 * Selectors for the accept/dismiss control of common consent-management platforms.
 * Order = specificity: exact CMP ids first, generic patterns last.
 */
export const CONSENT_ACCEPT_SELECTORS: string[] = [
  '#onetrust-accept-btn-handler',
  'button.sp_choice_type_11', // Sourcepoint "accept all" (rendered inside its notice iframe)
  'button[title="Accept all"]',
  '.qc-cmp2-summary-buttons button[mode="primary"]', // Quantcast Choice
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '#didomi-notice-agree-button',
  '.cky-btn-accept',
  '.cc-btn.cc-dismiss',
  '.cc-btn.cc-allow',
  '.cc-allow',
  '#hs-eu-confirmation-button',
  '.iubenda-cs-accept-btn',
  '#truste-consent-button',
  '#axeptio_btn_acceptAll',
  '.osano-cm-accept-all',
  '#klaro .cm-btn-success',
  'button[data-cookiefirst-action="accept"]',
  '.js-cookie-consent-agree',
  '#cookie-accept',
  '#accept-cookies',
  '#acceptCookies',
  '#gdpr-cookie-accept',
  '.cookie-consent-accept',
  '.cookie-accept',
  '[data-testid="cookie-policy-manage-dialog-accept-button"]',
  '[data-action="accept-cookies"]',
  'button[data-consent="accept"]',
  'button[aria-label*="accept all" i]',
  'button[aria-label*="accept cookies" i]',
  'button[aria-label*="alle akzeptieren" i]',
];

/** Shadow-DOM hosts whose accept button lives inside a shadow root. */
export const CONSENT_SHADOW_HOSTS: Array<{ host: string; button: string }> = [
  { host: '#usercentrics-root', button: '[data-testid="uc-accept-all-button"]' },
  { host: '#usercentrics-cmp-ui', button: '#accept' },
  { host: '#cmpwrapper', button: '#cmpwelcomebtnyes, .cmpboxbtnyes' },
];

/** Accept-button texts (exact, case-insensitive) — multi-language, most common phrasings. */
export const CONSENT_ACCEPT_TEXT =
  /^(accept( all)?( cookies)?|accept (and|&) continue|consent (and|&) continue|agree (and|&) continue|allow( all)?( cookies)?|agree|i agree|agree (and|&) close|got it|ok(ay)?|yes,? i agree|zustimmen (und|&) weiter|akzeptieren (und|&) weiter|einverstanden (und|&) weiter|alle akzeptieren|akzeptieren|alle cookies akzeptieren|zustimmen|alle zulassen|alle auswählen|einverstanden|verstanden|accepter( tout)?|tout accepter|j'accepte|aceptar( todo| todas)?|accetta( tutto)?|accetto|accepteren|alles accepteren|akceptuj( wszystkie)?|zgadzam się|прийняти( все)?|погоджуюсь|принять( все)?|souhlasím|přijmout vše|acceptér( alle)?|godkänn( alla)?|hyväksy( kaikki)?)$/i;

/**
 * Stricter accept-text pattern for buttons found inside child iframes (Sourcepoint, Quantcast,
 * some TCF vendors render the whole notice in an iframe). No bare "OK"/"Got it"/"Agree" here —
 * an ad or embed iframe may legitimately contain those.
 */
export const CONSENT_FRAME_ACCEPT_TEXT =
  /^(accept( all)?( cookies)?|accept (and|&) continue|consent (and|&) continue|agree (and|&) continue|allow all( cookies)?|yes,? i agree|alle akzeptieren|alle cookies akzeptieren|zustimmen (und|&) weiter|akzeptieren (und|&) weiter|einverstanden (und|&) weiter|tout accepter|accepter( tout)?|aceptar todo|accetta tutto|alles accepteren|akceptuj wszystkie|прийняти все|принять все)$/i;

/** Known CMP root containers hidden as a fallback when nothing could be clicked. */
export const CONSENT_CONTAINER_SELECTORS: string[] = [
  '#onetrust-consent-sdk',
  '[id^="sp_message_container_"]', // Sourcepoint notice host
  '.sp_veil',
  '.qc-cmp2-container', // Quantcast Choice
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  '#usercentrics-root',
  '#usercentrics-cmp-ui',
  '#didomi-host',
  '.cky-consent-container',
  '.cky-overlay',
  '.cc-window',
  '#hs-eu-cookie-confirmation',
  '#iubenda-cs-banner',
  '#truste-consent-track',
  '#axeptio_overlay',
  '.osano-cm-window',
  '#klaro',
  '#cmpbox',
  '#cmpbox2',
  '.cookiefirst-root',
  '#cookie-banner',
  '#cookiebanner',
  '#cookie-consent',
  '#cookieConsent',
  '.cookie-banner',
  '.cookie-consent',
  '.cookie-notice',
  '.cookie-bar',
  '[id*="cookie-banner" i]',
  '[class*="cookie-banner" i]',
  '[id*="cookie-consent" i]',
  '[class*="cookie-consent" i]',
  '[id*="cookiebanner" i]',
  '[class*="cookiebanner" i]',
  '[role="dialog"][aria-label*="cookie" i]',
  '[role="dialog"][aria-label*="consent" i]',
  '[role="dialog"][aria-label*="privacy" i]',
];

export interface ConsentDismissResult {
  /** 'clicked' when an accept control was activated, 'hidden' when only CSS fallback applied, 'none' if nothing matched. */
  action: 'clicked' | 'hidden' | 'none';
  /** What was clicked/hidden (selector or button text) — for the stdout note. */
  target?: string;
}

/** The in-page click routine, run against one frame. Returns what was clicked or null. */
async function clickAcceptIn(
  frame: Frame,
  opts: { inChildFrame: boolean },
): Promise<string | null> {
  return frame.evaluate(
    (args: {
      selectors: string[];
      shadowHosts: Array<{ host: string; button: string }>;
      textPattern: string;
      requireOverlay: boolean;
    }) => {
      const isVisible = (el: Element): boolean => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')
          return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      for (const sel of args.selectors) {
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          continue;
        }
        if (el && isVisible(el)) {
          (el as HTMLElement).click();
          return sel;
        }
      }
      for (const sh of args.shadowHosts) {
        const host = document.querySelector(sh.host);
        const root = host && (host as HTMLElement).shadowRoot;
        if (!root) continue;
        const btn = root.querySelector(sh.button);
        if (btn && isVisible(btn)) {
          (btn as HTMLElement).click();
          return `${sh.host} ${sh.button}`;
        }
      }
      const re = new RegExp(args.textPattern, 'i');
      for (const el of document.querySelectorAll('button, [role="button"], a')) {
        const t = (el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!t || t.length > 40 || !re.test(t)) continue;
        if (!isVisible(el)) continue;
        if (args.requireOverlay) {
          // Main document: must sit inside something that looks like an overlay/banner — a
          // fixed/sticky ancestor or a dialog. A plain in-content "OK" button is not consent.
          // (Inside a CMP iframe the whole document IS the overlay, so this is skipped there.)
          let cur: Element | null = el;
          let inOverlay = false;
          while (cur && cur !== document.body) {
            const cs = getComputedStyle(cur);
            if (
              cs.position === 'fixed' ||
              cs.position === 'sticky' ||
              cur.getAttribute('role') === 'dialog' ||
              cur.tagName === 'DIALOG'
            ) {
              inOverlay = true;
              break;
            }
            cur = cur.parentElement;
          }
          if (!inOverlay) continue;
        }
        (el as HTMLElement).click();
        return `button "${t}"`;
      }
      return null;
    },
    {
      selectors: CONSENT_ACCEPT_SELECTORS,
      shadowHosts: CONSENT_SHADOW_HOSTS,
      textPattern: (opts.inChildFrame ? CONSENT_FRAME_ACCEPT_TEXT : CONSENT_ACCEPT_TEXT).source,
      requireOverlay: !opts.inChildFrame,
    },
  );
}

/**
 * Try to dismiss a consent banner: click a known accept control (incl. inside known
 * shadow roots), else a visible button whose text is an accept phrase, else hide known
 * CMP containers via CSS. Best-effort, never throws.
 */
export async function dismissConsent(page: Page): Promise<ConsentDismissResult> {
  try {
    let clicked: string | null = await clickAcceptIn(page.mainFrame(), { inChildFrame: false });

    // iframe-hosted notices (Sourcepoint, Quantcast, …): the wall lives in a child frame that
    // the main-document scan can't see. Same routine, stricter text match, no overlay test.
    if (!clicked) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        if (!/^https?:/.test(frame.url())) continue;
        try {
          const hit = await clickAcceptIn(frame, { inChildFrame: true });
          if (hit) {
            clicked = `${hit} (in frame ${new URL(frame.url()).hostname})`;
            break;
          }
        } catch {
          /* frame navigated away / detached — try the next */
        }
      }
    }

    if (clicked) {
      // Let the CMP run its close animation / remove its overlay (iframe CMPs round-trip a
      // postMessage to the parent) before we measure or shoot.
      await page.waitForTimeout(clicked.includes('(in frame') ? 900 : 400);
    }

    // CSS fallback: hide known containers that survived (or that had no clickable control).
    // Only overlay-like matches (fixed/sticky/absolute or dialog) are hidden, so a footer
    // link that merely has "cookie-consent" in its class name is left alone.
    const hidden: number = await page.evaluate((sels: string[]) => {
      let n = 0;
      for (const sel of sels) {
        try {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(el);
            const overlayLike =
              cs.position === 'fixed' ||
              cs.position === 'sticky' ||
              cs.position === 'absolute' ||
              el.getAttribute('role') === 'dialog' ||
              el.tagName === 'DIALOG' ||
              el.querySelector('[role="dialog"], dialog') !== null;
            if (!overlayLike) continue;
            el.setAttribute('data-looksy-consent-hidden', '');
            n++;
          }
        } catch {
          /* invalid selector — skip */
        }
      }
      return n;
    }, CONSENT_CONTAINER_SELECTORS);
    if (hidden > 0) {
      await page.addStyleTag({
        content: '[data-looksy-consent-hidden] { display: none !important; }',
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    }

    if (clicked) return { action: 'clicked', target: clicked };
    if (hidden > 0) return { action: 'hidden', target: `${hidden} container(s)` };
    return { action: 'none' };
  } catch {
    return { action: 'none' };
  }
}
