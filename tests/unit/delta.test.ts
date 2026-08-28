import { describe, it, expect } from 'vitest';
import { compareDeltaSnapshots, type DeltaSnapshot } from '../../src/delta.js';

const baseBefore: DeltaSnapshot = {
  url: 'http://localhost:3000',
  capturedAt: '2026-03-13T20:00:00Z',
  title: 'My Site',
  pageHeight: 3200,
  elementCount: 25,
  fonts: ['Geist Sans', 'Geist Mono'],
  cssVarCount: 10,
  colorPalette: ['rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
  headingStructure: 'H1,H2,H2,H3',
  contrastFailures: 0,
  a11yIssueCount: 0,
};

describe('compareDeltaSnapshots', () => {
  it('reports no changes when identical', () => {
    const report = compareDeltaSnapshots(baseBefore, baseBefore);
    expect(report).toContain('No changes');
  });

  it('detects title change', () => {
    const after: DeltaSnapshot = { ...baseBefore, title: 'New Site Title' };
    const report = compareDeltaSnapshots(baseBefore, after);
    expect(report).toContain('My Site');
    expect(report).toContain('New Site Title');
    expect(report).toContain('→');
  });

  it('detects page height change with percentage', () => {
    const after: DeltaSnapshot = { ...baseBefore, pageHeight: 4100 };
    const report = compareDeltaSnapshots(baseBefore, after);
    expect(report).toContain('3200px → 4100px');
    expect(report).toContain('%');
  });

  it('detects font changes showing added and removed fonts', () => {
    const after: DeltaSnapshot = { ...baseBefore, fonts: ['Inter', 'Geist Mono'] };
    const report = compareDeltaSnapshots(baseBefore, after);
    expect(report).toContain('fonts');
    // Geist Sans removed, Inter added
    expect(report).toContain('Geist Sans');
    expect(report).toContain('Inter');
  });

  it('detects new contrast failures', () => {
    const after: DeltaSnapshot = { ...baseBefore, contrastFailures: 3 };
    const report = compareDeltaSnapshots(baseBefore, after);
    expect(report.toLowerCase()).toContain('contrast');
    expect(report).toContain('3');
  });

  it('shows unchanged sections when only height changed', () => {
    const after: DeltaSnapshot = { ...baseBefore, pageHeight: 4100 };
    const report = compareDeltaSnapshots(baseBefore, after);
    expect(report).toContain('Unchanged:');
    // These should all be unchanged
    expect(report).toContain('fonts');
    expect(report).toContain('headings');
  });
});
