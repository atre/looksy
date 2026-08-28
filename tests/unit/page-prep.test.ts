import { describe, it, expect } from 'vitest';
import {
  parseKeyValuePairs,
  cookiesForUrl,
  CONSENT_ACCEPT_TEXT,
  CONSENT_FRAME_ACCEPT_TEXT,
  CONSENT_ACCEPT_SELECTORS,
  CONSENT_CONTAINER_SELECTORS,
} from '../../src/page-prep.js';

describe('parseKeyValuePairs (--cookie / --local-storage)', () => {
  it('splits on ; and keeps = inside values', () => {
    expect(parseKeyValuePairs('a=1; b=x=y ;c=')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'x=y' },
      { name: 'c', value: '' },
    ]);
  });
  it('accepts newline separators and ignores junk', () => {
    expect(parseKeyValuePairs('a=1\nnovalue\n=orphan\nb=2')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
  });
  it('returns [] for undefined/empty', () => {
    expect(parseKeyValuePairs(undefined)).toEqual([]);
    expect(parseKeyValuePairs('')).toEqual([]);
  });
});

describe('cookiesForUrl', () => {
  it('scopes cookies to the URL hostname with path=/', () => {
    expect(cookiesForUrl('session=abc', 'https://shop.example.com/de/cart')).toEqual([
      { name: 'session', value: 'abc', domain: 'shop.example.com', path: '/' },
    ]);
  });
  it('falls back to localhost for unparseable URLs', () => {
    expect(cookiesForUrl('a=1', 'not a url')[0].domain).toBe('localhost');
  });
});

describe('consent heuristics', () => {
  it('accept-text pattern matches common multi-language labels, not arbitrary buttons', () => {
    for (const t of ['Accept all', 'Alle akzeptieren', 'Akzeptieren', 'Tout accepter', 'Got it', 'OK', 'Прийняти', 'Aceptar']) {
      expect(CONSENT_ACCEPT_TEXT.test(t), t).toBe(true);
    }
    for (const t of ['Add to cart', 'Submit', 'Accept the terms and continue to checkout', 'Ok, show me more']) {
      expect(CONSENT_ACCEPT_TEXT.test(t), t).toBe(false);
    }
  });
  it('frame pattern is stricter: no bare OK / Got it inside child iframes', () => {
    for (const t of ['Accept all', 'Consent and continue', 'Agree and continue', 'Alle akzeptieren']) {
      expect(CONSENT_FRAME_ACCEPT_TEXT.test(t), t).toBe(true);
    }
    for (const t of ['OK', 'Got it', 'Agree', 'Subscribe now', 'Preferences']) {
      expect(CONSENT_FRAME_ACCEPT_TEXT.test(t), t).toBe(false);
    }
  });
  it('selector lists are valid CSS (no throw in a DOM-less parser check)', () => {
    // Cheap sanity: every selector is non-empty and has balanced brackets.
    for (const sel of [...CONSENT_ACCEPT_SELECTORS, ...CONSENT_CONTAINER_SELECTORS]) {
      expect(sel.length).toBeGreaterThan(0);
      expect((sel.match(/\[/g) || []).length).toBe((sel.match(/\]/g) || []).length);
    }
    expect(CONSENT_ACCEPT_SELECTORS).toContain('#onetrust-accept-btn-handler');
    expect(CONSENT_CONTAINER_SELECTORS).toContain('#usercentrics-root');
  });
});
