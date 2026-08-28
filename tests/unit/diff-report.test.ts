import { describe, it, expect } from 'vitest';
import { compareSemanticSnapshots, type SemanticSnapshot } from '../../src/diff-report.js';

const baseBefore: SemanticSnapshot = {
  title: 'My Site',
  pageHeight: 3200,
  fonts: ['Geist Sans', 'Geist Mono'],
  fontDetails: [
    { family: 'Geist Sans', weight: '400', style: 'normal', status: 'loaded' },
    { family: 'Geist Mono', weight: '400', style: 'normal', status: 'loaded' },
  ],
  colors: [
    { property: 'background-color', value: 'rgb(255, 255, 255)', element: 'body' },
    { property: 'color', value: 'rgb(0, 0, 0)', element: 'body' },
  ],
  headings: [
    { level: 1, text: 'Welcome' },
    { level: 2, text: 'Features' },
  ],
  cssVars: [
    { name: '--primary', value: '#1a1a1a' },
    { name: '--background', value: '#ffffff' },
  ],
  elementCount: 25,
};

describe('compareSemanticSnapshots', () => {
  it('detects font changes', () => {
    const after: SemanticSnapshot = {
      ...baseBefore,
      fonts: ['DM Sans', 'DM Mono', 'Archivo Black'],
    };
    const report = compareSemanticSnapshots(baseBefore, after);
    expect(report).toContain('### Fonts');
    expect(report).toContain('Removed: Geist Sans, Geist Mono');
    expect(report).toContain('Added: DM Sans, DM Mono, Archivo Black');
  });

  it('detects color changes', () => {
    const after: SemanticSnapshot = {
      ...baseBefore,
      colors: [
        { property: 'background-color', value: 'rgb(26, 26, 26)', element: 'body' },
        { property: 'color', value: 'rgb(255, 255, 255)', element: 'body' },
      ],
    };
    const report = compareSemanticSnapshots(baseBefore, after);
    expect(report).toContain('### Colors');
    expect(report).toContain('→');
  });

  it('detects CSS variable changes', () => {
    const after: SemanticSnapshot = {
      ...baseBefore,
      cssVars: [
        { name: '--primary', value: '#5A6D52' },
        { name: '--background', value: '#ffffff' },
        { name: '--accent', value: '#ff6600' },
      ],
    };
    const report = compareSemanticSnapshots(baseBefore, after);
    expect(report).toContain('### CSS Variables');
    expect(report).toContain('--primary');
    expect(report).toContain('#1a1a1a → #5A6D52');
    expect(report).toContain('--accent');
  });

  it('detects heading structure changes', () => {
    const after: SemanticSnapshot = {
      ...baseBefore,
      headings: [
        { level: 1, text: 'Welcome' },
        { level: 2, text: 'Features' },
        { level: 2, text: 'Pricing' },
      ],
    };
    const report = compareSemanticSnapshots(baseBefore, after);
    expect(report).toContain('### Heading Structure');
    expect(report).toContain('H2: Pricing');
  });

  it('detects layout changes', () => {
    const after: SemanticSnapshot = {
      ...baseBefore,
      pageHeight: 4100,
      elementCount: 30,
    };
    const report = compareSemanticSnapshots(baseBefore, after);
    expect(report).toContain('### Layout');
    expect(report).toContain('3200px → 4100px');
    expect(report).toContain('25 → 30');
  });

  it('reports no changes when snapshots are identical', () => {
    const report = compareSemanticSnapshots(baseBefore, baseBefore);
    expect(report).toContain('No semantic changes detected');
  });
});
