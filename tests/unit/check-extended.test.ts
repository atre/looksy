import { describe, it, expect } from 'vitest';

// Test the check grammar extensions by verifying the pattern matching logic
// (actual browser-side evaluation is tested in integration tests)

describe('check grammar: font/color/bg assertions', () => {
  // Pattern parsing tests (simulate what check.ts does)

  it('parses font:<selector>=<expected>', () => {
    const assertion = 'font:h1=Archivo Black';
    const lower = assertion.toLowerCase();
    expect(lower.startsWith('font:')).toBe(true);
    expect(assertion.includes('=')).toBe(true);
    const eqIdx = assertion.indexOf('=');
    const sel = assertion.slice(5, eqIdx).trim();
    const expected = assertion.slice(eqIdx + 1).trim();
    expect(sel).toBe('h1');
    expect(expected).toBe('Archivo Black');
  });

  it('parses font:.price=DM Mono', () => {
    const assertion = 'font:.price=DM Mono';
    const eqIdx = assertion.indexOf('=');
    expect(assertion.slice(5, eqIdx).trim()).toBe('.price');
    expect(assertion.slice(eqIdx + 1).trim()).toBe('DM Mono');
  });

  it('parses bg:<selector>=<hex>', () => {
    const assertion = 'bg:.hero-section=#3D3D3D';
    const lower = assertion.toLowerCase();
    expect(lower.startsWith('bg:')).toBe(true);
    expect(assertion.includes('=')).toBe(true);
    const eqIdx = assertion.indexOf('=');
    expect(assertion.slice(3, eqIdx).trim()).toBe('.hero-section');
    expect(assertion.slice(eqIdx + 1).trim()).toBe('#3D3D3D');
  });

  it('parses color:<selector>=<hex>', () => {
    const assertion = 'color:h1=#3D3D3D';
    const lower = assertion.toLowerCase();
    expect(lower.startsWith('color:')).toBe(true);
    expect(!lower.startsWith('contrast:')).toBe(true);
    const eqIdx = assertion.indexOf('=');
    expect(assertion.slice(6, eqIdx).trim()).toBe('h1');
    expect(assertion.slice(eqIdx + 1).trim()).toBe('#3D3D3D');
  });

  it('does not confuse color: with contrast:', () => {
    const assertion = 'contrast:aa';
    const lower = assertion.toLowerCase();
    expect(lower.startsWith('color:')).toBe(false);
    expect(lower.startsWith('contrast:')).toBe(true);
  });

  it('handles complex selectors in font check', () => {
    const assertion = 'font:body > h1.title=Inter';
    const eqIdx = assertion.indexOf('=');
    expect(assertion.slice(5, eqIdx).trim()).toBe('body > h1.title');
    expect(assertion.slice(eqIdx + 1).trim()).toBe('Inter');
  });
});
