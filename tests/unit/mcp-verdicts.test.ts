import { describe, it, expect } from 'vitest';
import {
  jsonBlock,
  withStructured,
  errorResult,
  contrastSeverity,
  buildContrastVerdict,
  buildThemeVerdict,
  buildDesignVerdict,
  buildDiffVerdict,
  DEFAULT_DIFF_THRESHOLD,
  riskLevelFor,
  buildFingerprintPairVerdict,
  buildFingerprintMatrixVerdict,
  buildDiffReportVerdict,
} from '../../src/mcp.js';
import type { ContrastPairResult } from '../../src/contrast.js';
import type { ThemeValidationResult } from '../../src/validate-theme.js';
import type { DesignValidationResult } from '../../src/design-spec.js';
import type { SemanticSnapshot } from '../../src/diff-report.js';

function pair(overrides: Partial<ContrastPairResult> = {}): ContrastPairResult {
  return {
    tag: 'p',
    text: 'hello',
    className: 'body-text',
    color: 'rgb(0, 0, 0)',
    bg: 'rgb(255, 255, 255)',
    ratio: 21,
    aaPass: true,
    aaaPass: true,
    ...overrides,
  };
}

function themeResult(overrides: Partial<ThemeValidationResult> = {}): ThemeValidationResult {
  return {
    label: 'body',
    fg: '#000000',
    bg: '#ffffff',
    ratio: 21,
    aaPass: true,
    aaaPass: true,
    ...overrides,
  };
}

function designResult(overrides: Partial<DesignValidationResult> = {}): DesignValidationResult {
  return {
    assertion: 'font h1 = Archivo Black',
    category: 'font',
    selector: 'h1',
    property: 'font-family',
    expected: 'Archivo Black',
    actual: 'Archivo Black',
    pass: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SemanticSnapshot> = {}): SemanticSnapshot {
  return {
    title: 'Home',
    pageHeight: 1000,
    fonts: ['Inter'],
    fontDetails: [],
    colors: [],
    headings: [{ level: 1, text: 'Welcome' }],
    cssVars: [],
    elementCount: 100,
    ...overrides,
  };
}

// ---------- jsonBlock / withStructured / errorResult ----------

describe('jsonBlock', () => {
  it('wraps data in a fenced json text block', () => {
    const block = jsonBlock({ ok: true });
    expect(block.type).toBe('text');
    expect(block.text.startsWith('```json\n')).toBe(true);
    expect(block.text.endsWith('\n```')).toBe(true);
    expect(JSON.parse(block.text.replace(/^```json\n/, '').replace(/\n```$/, ''))).toEqual({
      ok: true,
    });
  });
});

describe('withStructured', () => {
  it('appends a json block to content and sets structuredContent', () => {
    const content = [{ type: 'text', text: 'hello' }];
    const structured = { ok: true, count: 3 };
    const result = withStructured(content, structured);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual(content[0]);
    expect(result.content[1].type).toBe('text');
    expect(result.structuredContent).toEqual(structured);
  });
});

describe('errorResult', () => {
  it('builds an MCP error result with ok:false JSON, never throwing', () => {
    const result = errorResult(new Error('boom'));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ ok: false, error: 'boom' });
    expect(result.content[0].text).toBe('Error: boom');
  });

  it('handles non-Error throwables', () => {
    const result = errorResult('plain string failure');
    expect(result.structuredContent).toEqual({ ok: false, error: 'plain string failure' });
  });
});

// ---------- contrastSeverity ----------

describe('contrastSeverity', () => {
  it('buckets low ratios as high severity', () => {
    expect(contrastSeverity(1.2)).toBe('high');
  });
  it('buckets mid ratios as medium severity', () => {
    expect(contrastSeverity(3.0)).toBe('medium');
  });
  it('buckets near-miss ratios as low severity', () => {
    expect(contrastSeverity(4.2)).toBe('low');
  });
});

// ---------- buildContrastVerdict ----------

describe('buildContrastVerdict', () => {
  it('passes when all pairs pass AA', () => {
    const verdict = buildContrastVerdict([pair(), pair({ tag: 'a' })]);
    expect(verdict.pass).toBe(true);
    expect(verdict.score).toBe(100);
    expect(verdict.issues).toHaveLength(0);
    expect(verdict.summary).toMatch(/All 2/);
  });

  it('fails and reports issues for failing pairs, with selector and severity', () => {
    const failing = pair({ tag: 'span', className: 'muted small', ratio: 1.5, aaPass: false });
    const verdict = buildContrastVerdict([pair(), failing]);
    expect(verdict.pass).toBe(false);
    expect(verdict.score).toBe(50);
    expect(verdict.issues).toHaveLength(1);
    expect(verdict.issues[0].selector).toBe('span.muted');
    expect(verdict.issues[0].severity).toBe('high');
    expect(verdict.summary).toMatch(/1\/2/);
  });

  it('falls back to bare tag as selector when no className', () => {
    const failing = pair({ tag: 'div', className: '', ratio: 3.0, aaPass: false });
    const verdict = buildContrastVerdict([failing]);
    expect(verdict.issues[0].selector).toBe('div');
  });

  it('attaches a fix when fixFor is provided', () => {
    const failing = pair({ ratio: 1.5, aaPass: false });
    const verdict = buildContrastVerdict([failing], {
      fixFor: () => 'lighten fg to #ffffff for 5.0:1',
    });
    expect(verdict.issues[0].fix).toBe('lighten fg to #ffffff for 5.0:1');
  });

  it('omits fix when fixFor returns undefined', () => {
    const failing = pair({ ratio: 1.5, aaPass: false });
    const verdict = buildContrastVerdict([failing], { fixFor: () => undefined });
    expect(verdict.issues[0].fix).toBeUndefined();
  });

  it('treats an empty pair list as a clean pass with score 100', () => {
    const verdict = buildContrastVerdict([]);
    expect(verdict.pass).toBe(true);
    expect(verdict.score).toBe(100);
  });
});

// ---------- buildThemeVerdict ----------

describe('buildThemeVerdict', () => {
  it('passes when all pairs pass AA', () => {
    const verdict = buildThemeVerdict([themeResult(), themeResult({ label: 'nav' })]);
    expect(verdict.pass).toBe(true);
    expect(verdict.issues).toHaveLength(0);
  });

  it('reports failing pairs with severity and message', () => {
    const failing = themeResult({
      label: 'muted',
      fg: '#999999',
      bg: '#ffffff',
      ratio: 2.85,
      aaPass: false,
    });
    const verdict = buildThemeVerdict([themeResult(), failing]);
    expect(verdict.pass).toBe(false);
    expect(verdict.issues[0].message).toMatch(/muted/);
    expect(verdict.issues[0].severity).toBe('medium');
  });
});

// ---------- buildDesignVerdict ----------

describe('buildDesignVerdict', () => {
  it('passes when all checks pass', () => {
    const verdict = buildDesignVerdict([designResult(), designResult({ selector: 'body' })]);
    expect(verdict.pass).toBe(true);
    expect(verdict.score).toBe(100);
  });

  it('marks spacing failures as low severity and others medium', () => {
    const fontFail = designResult({
      category: 'font',
      pass: false,
      actual: 'Arial',
      selector: 'h1',
    });
    const spacingFail = designResult({
      category: 'spacing',
      pass: false,
      selector: 'section',
      property: 'padding-top',
      actual: '32px',
      expected: '64px',
    });
    const verdict = buildDesignVerdict([fontFail, spacingFail]);
    expect(verdict.pass).toBe(false);
    expect(verdict.issues.find((i) => i.selector === 'h1')?.severity).toBe('medium');
    expect(verdict.issues.find((i) => i.selector === 'section')?.severity).toBe('low');
  });
});

// ---------- buildDiffVerdict ----------

describe('buildDiffVerdict', () => {
  it('passes when change percent is within the default threshold', () => {
    const verdict = buildDiffVerdict({
      changedPixels: 10,
      totalPixels: 100000,
      changePercent: '0.01',
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.issues).toHaveLength(0);
    expect(verdict.score).toBe(0.01);
  });

  it('fails and grades severity when change percent exceeds threshold', () => {
    const verdict = buildDiffVerdict({
      changedPixels: 5000,
      totalPixels: 100000,
      changePercent: '5.00',
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.issues[0].severity).toBe('high'); // 5.00 > 0.5*4
    expect(verdict.issues[0].message).toMatch(/5000\/100000/);
  });

  it('respects a custom threshold', () => {
    const verdict = buildDiffVerdict(
      { changedPixels: 100, totalPixels: 1000, changePercent: '10.00' },
      20,
    );
    expect(verdict.pass).toBe(true);
  });

  it('uses DEFAULT_DIFF_THRESHOLD (0.5) when no threshold given', () => {
    const atThreshold = buildDiffVerdict({
      changedPixels: 5,
      totalPixels: 1000,
      changePercent: '0.5',
    });
    expect(DEFAULT_DIFF_THRESHOLD).toBe(0.5);
    expect(atThreshold.pass).toBe(true);
  });
});

// ---------- riskLevelFor ----------

describe('riskLevelFor', () => {
  it('bands scores into HIGH/MEDIUM/LOW/MINIMAL matching fingerprint.ts thresholds', () => {
    expect(riskLevelFor(85)).toBe('HIGH');
    expect(riskLevelFor(80)).toBe('HIGH');
    expect(riskLevelFor(60)).toBe('MEDIUM');
    expect(riskLevelFor(50)).toBe('MEDIUM');
    expect(riskLevelFor(25)).toBe('LOW');
    expect(riskLevelFor(20)).toBe('LOW');
    expect(riskLevelFor(5)).toBe('MINIMAL');
  });
});

// ---------- buildFingerprintPairVerdict ----------

describe('buildFingerprintPairVerdict', () => {
  it('passes (low correlation risk) below the medium-risk band', () => {
    const verdict = buildFingerprintPairVerdict({
      nameA: 'site-a',
      nameB: 'site-b',
      overall: 12,
      dimensions: [{ name: 'Hashed Classes', score: 0.1, weight: 15, detail: '1 shared of 10' }],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.issues).toHaveLength(0);
  });

  it('fails and surfaces high-similarity dimensions as issues', () => {
    const verdict = buildFingerprintPairVerdict({
      nameA: 'site-a',
      nameB: 'site-b',
      overall: 82,
      dimensions: [
        { name: 'Asset Filenames', score: 0.9, weight: 25, detail: '18 shared of 20 unique' },
        { name: 'Font Sources', score: 0.2, weight: 10, detail: 'no overlap' },
      ],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.issues).toHaveLength(1);
    expect(verdict.issues[0].severity).toBe('high');
    expect(verdict.summary).toMatch(/HIGH risk/);
  });
});

// ---------- buildFingerprintMatrixVerdict ----------

describe('buildFingerprintMatrixVerdict', () => {
  it('passes when no pairwise score reaches the medium-risk band', () => {
    const verdict = buildFingerprintMatrixVerdict(
      ['a', 'b', 'c'],
      [
        { a: 'a', b: 'b', score: 10 },
        { a: 'a', b: 'c', score: 20 },
        { a: 'b', b: 'c', score: 30 },
      ],
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.issues).toHaveLength(0);
  });

  it('fails and lists each high-risk pair', () => {
    const verdict = buildFingerprintMatrixVerdict(
      ['a', 'b', 'c'],
      [
        { a: 'a', b: 'b', score: 90 },
        { a: 'a', b: 'c', score: 10 },
        { a: 'b', b: 'c', score: 55 },
      ],
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.issues).toHaveLength(2);
    expect(verdict.score).toBe(90);
  });
});

// ---------- buildDiffReportVerdict ----------

describe('buildDiffReportVerdict', () => {
  it('passes when snapshots are identical', () => {
    const s = snapshot();
    const verdict = buildDiffReportVerdict(s, snapshot());
    expect(verdict.pass).toBe(true);
    expect(verdict.issues).toHaveLength(0);
    expect(verdict.summary).toMatch(/No semantic changes/);
  });

  it('flags font and heading structure changes', () => {
    const before = snapshot({ fonts: ['Inter'], headings: [{ level: 1, text: 'Welcome' }] });
    const after = snapshot({
      fonts: ['Inter', 'Archivo Black'],
      headings: [
        { level: 1, text: 'Welcome' },
        { level: 2, text: 'New Section' },
      ],
    });
    const verdict = buildDiffReportVerdict(before, after);
    expect(verdict.pass).toBe(false);
    expect(verdict.issues.some((i) => i.message.includes('Fonts changed'))).toBe(true);
    expect(verdict.issues.some((i) => i.message.includes('Heading structure changed'))).toBe(true);
  });

  it('flags a large page-height shift as medium severity, small shift as low', () => {
    const before = snapshot({ pageHeight: 1000 });
    const bigShift = buildDiffReportVerdict(before, snapshot({ pageHeight: 1500 }));
    const smallShift = buildDiffReportVerdict(before, snapshot({ pageHeight: 1020 }));
    expect(bigShift.issues.find((i) => i.message.startsWith('Page height'))?.severity).toBe(
      'medium',
    );
    expect(smallShift.issues.find((i) => i.message.startsWith('Page height'))?.severity).toBe(
      'low',
    );
  });

  it('flags title changes', () => {
    const verdict = buildDiffReportVerdict(
      snapshot({ title: 'Home' }),
      snapshot({ title: 'Landing' }),
    );
    expect(verdict.issues.some((i) => i.message.includes('Title:'))).toBe(true);
  });
});
