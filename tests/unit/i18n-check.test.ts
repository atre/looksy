import { describe, it, expect } from 'vitest';
import { compareLocales, type LocaleSnapshot } from '../../dist/i18n-check.js';

const en: LocaleSnapshot = {
  url: 'http://localhost:3000/en/pricing',
  title: 'Pricing',
  lang: 'en',
  headingCount: 3,
  sectionCount: 5,
  textLength: 2000,
  pageHeight: 3000,
  headings: ['Pricing', 'Plans', 'FAQ'],
};

describe('compareLocales', () => {
  it('reports match for identical structure', () => {
    const de: LocaleSnapshot = { ...en, url: 'http://localhost:3000/de/pricing', lang: 'de' };
    const result = compareLocales(en, de);
    expect(result).toContain('consistent');
  });

  it('flags heading count difference', () => {
    const de: LocaleSnapshot = { ...en, url: 'http://localhost:3000/de/pricing', lang: 'de', headingCount: 2 };
    const result = compareLocales(en, de);
    expect(result).toContain('Headings: 3 vs 2');
  });

  it('flags text length delta', () => {
    const de: LocaleSnapshot = { ...en, url: 'http://localhost:3000/de/pricing', lang: 'de', textLength: 3500 };
    const result = compareLocales(en, de);
    expect(result).toContain('Text length');
  });

  it('flags page height delta', () => {
    const de: LocaleSnapshot = { ...en, url: 'http://localhost:3000/de/pricing', lang: 'de', pageHeight: 4500 };
    const result = compareLocales(en, de);
    expect(result).toContain('Page height');
  });

  it('compact mode uses short header', () => {
    const de: LocaleSnapshot = { ...en, url: 'http://localhost:3000/de/pricing', lang: 'de', headingCount: 1 };
    const result = compareLocales(en, de, { compact: true });
    expect(result).toContain('## i18n Check');
  });
});
