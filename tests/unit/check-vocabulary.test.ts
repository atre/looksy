import { describe, it, expect } from 'vitest';
import { CHECK_ASSERTIONS, isKnownAssertion, knownAssertionHint } from '../../src/check.js';

describe('--check assertion vocabulary', () => {
  it('documents every bare assertion the runtime accepts', () => {
    const doc = CHECK_ASSERTIONS.map((a) => a.syntax).join(' ');
    for (const name of [
      'no-hscroll', 'touch-targets', 'h1-count', 'heading-outline', 'no-broken-images', 'alt-text',
      'lang', 'canonical', 'meta-description', 'og-image', 'twitter-card', 'no generator',
      'translated', 'self-hosted-fonts', 'no-google-fonts', 'unique-footer', 'unique-nav', 'contrast:aa',
    ]) {
      expect(doc, name).toContain(name);
      expect(isKnownAssertion(name), name).toBe(true);
    }
  });

  it('accepts parameterised and prefixed forms', () => {
    for (const a of [
      'touch-targets:24', 'h1-count:2', 'sticky header', 'dark bg', 'light bg:.hero', 'text:hello',
      'class:btn', 'selector:.x', 'count:3 .card', 'has .nav', 'no border-primary', 'visible .cta',
      'hidden .modal', 'font:h1=Inter', 'bg:.hero=#fff', 'color:p=#000', 'Contrast:AAA',
    ]) {
      expect(isKnownAssertion(a), a).toBe(true);
    }
  });

  it('rejects unknown names instead of coercing them into a text search', () => {
    for (const a of ['banana', 'touch targets', 'touch-targets:x', 'hero', 'no-hscrol']) {
      expect(isKnownAssertion(a), a).toBe(false);
    }
  });

  it('hint lists the vocabulary so the failure is self-explanatory', () => {
    const hint = knownAssertionHint();
    expect(hint).toContain('no-hscroll');
    expect(hint).toContain('touch-targets[:N]');
    expect(hint.split(', ').length).toBe(CHECK_ASSERTIONS.length);
  });
});
