import { describe, it, expect } from 'vitest';
import { toFindings } from '../../src/findings.js';

describe('toFindings', () => {
  it('failed check → crit; contrast AA fail without a check → warn', () => {
    const findings = toFindings([
      {
        url: 'https://a.com/',
        result: {
          checkResultsData: [
            {
              assertion: 'no-hscroll',
              pass: false,
              detail: 'page 549px vs viewport 375px (+174px horizontal scroll)',
            },
          ],
          contrastFailures: { aa: 2, aaa: 9 },
        },
      },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      id: 'visual:https://a.com/no-hscroll',
      scope: 'site',
      severity: 'crit',
      title: 'no-hscroll: +174px at 375px',
      hint: '--sweep',
    });
    expect(findings[1]).toMatchObject({
      id: 'visual:https://a.com/contrast',
      scope: 'site',
      severity: 'warn',
      title: 'contrast: 2 AA fail',
    });
  });

  it('failed check title is `<check>: <detail>` (one line, ≤80 chars) or `<check> failed` without detail', () => {
    const findings = toFindings([
      {
        url: 'https://e.com',
        result: {
          checkResultsData: [
            { assertion: 'alt-text', pass: false, detail: '3 <img>\n without alt' },
            { assertion: 'canonical', pass: false, detail: '' },
            { assertion: 'text:foo', pass: false, detail: 'x'.repeat(120) },
          ],
        },
      },
    ]);
    expect(findings.map((f) => f.title)).toEqual([
      'alt-text: 3 <img> without alt',
      'canonical failed',
      `text: ${'x'.repeat(77)}…`,
    ]);
    expect(findings.every((f) => f.scope === 'site')).toBe(true);
  });

  it('all checks pass, no contrast/hscroll/touch-target issues → []', () => {
    const findings = toFindings([
      {
        url: 'https://b.com/',
        result: {
          checkResultsData: [{ assertion: 'no-hscroll', pass: true, detail: 'ok' }],
          contrastFailures: { aa: 0, aaa: 0 },
        },
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('does not duplicate a warn finding when the same check name already ran and passed', () => {
    const findings = toFindings([
      {
        url: 'https://c.com/',
        result: {
          checkResultsData: [{ assertion: 'contrast:aa', pass: true, detail: 'ok' }],
          contrastFailures: { aa: 3, aaa: 0 },
        },
      },
    ]);
    expect(findings).toEqual([]);
  });

  it('hscroll and touch-targets surface as warn findings when not covered by --check', () => {
    const findings = toFindings([
      {
        url: 'https://d.com/',
        result: {
          pageInfo: { width: 396, height: 800, title: '', viewportWidth: 375 },
          responsiveCheckResult: {
            breakpoints: [
              {
                width: 375,
                label: 'Mobile',
                issues: [],
                hasHorizontalOverflow: false,
                smallTouchTargets: 3,
                tinyText: 0,
                pageHeight: 800,
                touchTargetDetails: [],
                tinyTextDetails: [],
              },
            ],
            totalIssues: 3,
            targetSize: 44,
          },
        },
      },
    ]);
    expect(findings).toEqual([
      {
        id: 'visual:https://d.com/no-hscroll',
        scope: 'site',
        severity: 'warn',
        title: 'no-hscroll: +21px at 375px',
        hint: '--sweep',
      },
      {
        id: 'visual:https://d.com/touch-targets',
        scope: 'site',
        severity: 'warn',
        title: 'touch-targets: 3 controls < 44px',
        hint: '--design-audit',
      },
    ]);
  });
});
