import { describe, it, expect } from 'vitest';
import {
  formatContrastText,
  INVISIBLE_RATIO_THRESHOLD,
  type ContrastPairResult,
} from '../../src/contrast.js';

// The contrast module's DOM-sampling half (extractContrast) requires browser context and is
// covered via integration/smoke tests. formatContrastText is the pure text-rendering half —
// no browser needed — so severity/ordering logic is tested directly against fixture pairs.

describe('contrast module', () => {
  it('exports extractContrast and ContrastPairResult', async () => {
    const mod = await import('../../dist/contrast.js');
    expect(typeof mod.extractContrast).toBe('function');
  });
});

function pair(overrides: Partial<ContrastPairResult>): ContrastPairResult {
  return {
    tag: 'p',
    text: 'text',
    className: '',
    color: 'rgb(1,1,1)',
    bg: 'rgb(2,2,2)',
    ratio: 1,
    aaPass: false,
    aaaPass: false,
    ...overrides,
  };
}

describe('formatContrastText — invisible severity', () => {
  it('1.2:1 pair renders as an [INVISIBLE] line before an ordinary 3.5:1 AA-fail line (compact mode)', () => {
    const invisible = pair({
      tag: 'span',
      text: 'ghost',
      ratio: 1.2,
      aaPass: false,
      aaaPass: false,
    });
    const ordinary = pair({ tag: 'p', text: 'dim', ratio: 3.5, aaPass: false, aaaPass: false });
    const text = formatContrastText([invisible, ordinary], { compact: true });

    const invisibleLineIdx = text.split('\n').findIndex((l) => l.includes('[INVISIBLE]'));
    const ordinaryLineIdx = text.split('\n').findIndex((l) => l.includes('"dim"'));
    expect(invisibleLineIdx).toBeGreaterThan(-1);
    expect(ordinaryLineIdx).toBeGreaterThan(-1);
    expect(invisibleLineIdx).toBeLessThan(ordinaryLineIdx);
    expect(text).toContain('[INVISIBLE] span "ghost" — 1.2:1');
    // Header count is still the total AA failures (2), not inflated by the invisible split.
    expect(text).toContain('## Contrast: 2/2 AA failure(s)');
  });

  it('full-mode table lists the invisible row first and tags it, without double-counting', () => {
    const invisible = pair({
      tag: 'span',
      text: 'ghost',
      ratio: 1.2,
      aaPass: false,
      aaaPass: false,
    });
    const ordinary = pair({ tag: 'p', text: 'dim', ratio: 3.5, aaPass: false, aaaPass: false });
    const text = formatContrastText([ordinary, invisible], { compact: false });

    const rows = text.split('\n').filter((l) => l.startsWith('| '));
    const invisibleRowIdx = rows.findIndex((l) => l.includes('[INVISIBLE]'));
    const ordinaryRowIdx = rows.findIndex((l) => l.includes('dim'));
    expect(invisibleRowIdx).toBeGreaterThan(-1);
    expect(invisibleRowIdx).toBeLessThan(ordinaryRowIdx);
    expect(text).toContain('1 invisible (< 1.5:1)');
    expect(text).toContain('2 AA contrast failure(s)');
  });

  it('a ratio right at the threshold (1.5) is not flagged invisible', () => {
    const atThreshold = pair({ ratio: INVISIBLE_RATIO_THRESHOLD, aaPass: false });
    const text = formatContrastText([atThreshold], { compact: true });
    expect(text).not.toContain('[INVISIBLE]');
  });

  it('no invisible pairs → no [INVISIBLE] lines, ordinary rendering unchanged', () => {
    const ordinary = pair({ tag: 'p', text: 'dim', ratio: 3.5, aaPass: false });
    const text = formatContrastText([ordinary], { compact: true });
    expect(text).not.toContain('[INVISIBLE]');
    expect(text).toContain('p "dim" — 3.5:1');
  });

  it('all pass → unaffected "All N pass" message regardless of invisible logic', () => {
    const passing = pair({ ratio: 10, aaPass: true, aaaPass: true });
    const text = formatContrastText([passing], { compact: true });
    expect(text).toContain('All 1 pass AA');
  });
});
