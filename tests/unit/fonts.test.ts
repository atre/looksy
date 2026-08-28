import { describe, it, expect } from 'vitest';
import { formatFonts, type FontInfo } from '../../src/fonts.js';

const font = (family: string, status: string): FontInfo => ({ family, weight: '400', style: 'normal', status });

describe('formatFonts — unloaded clarity', () => {
  it('explains unloaded status in full mode (not flagged as an error)', () => {
    const out = formatFonts([font('Inter', 'loaded'), font('Archivo', 'unloaded')]);
    expect(out).toContain('unloaded (declared, not rendered)');
    expect(out).toContain('not requested by the browser at capture');
    expect(out).toContain('not an error');
  });

  it('explains unloaded status in compact mode', () => {
    const out = formatFonts([font('Archivo', 'unloaded')], { compact: true });
    expect(out).toContain('[unloaded]');
    expect(out).toContain('not requested by the browser at capture');
  });

  it('omits the unloaded note when all fonts are loaded', () => {
    const out = formatFonts([font('Inter', 'loaded')]);
    expect(out).not.toContain('not requested by the browser');
    expect(out).toContain('Loaded');
  });

  it('still surfaces real load failures', () => {
    const out = formatFonts([font('Broken', 'error')]);
    expect(out).toContain('failed to load');
    expect(out).toContain('**ERROR**');
  });
});
