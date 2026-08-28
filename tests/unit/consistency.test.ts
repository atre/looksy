import { describe, it, expect } from 'vitest';
import { compareSnapshots, type PageSnapshot } from '../../dist/consistency.js';

const base: PageSnapshot = {
  url: 'http://localhost:3000/',
  title: 'Home',
  headings: [{ level: 1, text: 'Welcome' }, { level: 2, text: 'Features' }],
  colors: ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'],
  fonts: ['Inter'],
  navLinks: ['Home', 'Pricing', 'Contact'],
  footerText: '© 2024 Acme Inc.',
};

describe('compareSnapshots', () => {
  it('reports no divergences for identical pages', () => {
    const result = compareSnapshots([base, { ...base, url: 'http://localhost:3000/pricing' }]);
    expect(result).toContain('same heading structure');
  });

  it('flags heading structure divergence', () => {
    const other: PageSnapshot = {
      ...base,
      url: 'http://localhost:3000/about',
      headings: [{ level: 1, text: 'About' }],
    };
    const result = compareSnapshots([base, other]);
    expect(result).toContain('Heading');
  });

  it('flags font divergence', () => {
    const other: PageSnapshot = {
      ...base,
      url: 'http://localhost:3000/blog',
      fonts: ['Inter', 'Comic Sans'],
    };
    const result = compareSnapshots([base, other]);
    expect(result).toContain('Font');
  });

  it('flags navigation divergence', () => {
    const other: PageSnapshot = {
      ...base,
      url: 'http://localhost:3000/old',
      navLinks: ['Home', 'Blog'],
    };
    const result = compareSnapshots([base, other]);
    expect(result).toContain('Navigation');
  });

  it('compact mode uses short format', () => {
    const other: PageSnapshot = { ...base, url: 'http://localhost:3000/about', navLinks: ['Home'] };
    const result = compareSnapshots([base, other], { compact: true });
    expect(result).toContain('## Consistency');
    expect(result).not.toContain('###');
  });

  it('needs at least 2 pages', () => {
    const result = compareSnapshots([base]);
    expect(result).toContain('at least 2');
  });
});
