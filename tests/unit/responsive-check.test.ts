import { describe, it, expect } from 'vitest';
import {
  formatResponsiveCheck,
  type ResponsiveCheckResult,
  type TouchTargetDetail,
  type TinyTextDetail,
} from '../../src/responsive-check.js';

function makeDetail(overrides: Partial<TouchTargetDetail> = {}): TouchTargetDetail {
  return {
    tag: 'a',
    text: 'Click me',
    className: 'btn',
    width: 36,
    height: 28,
    inlineExempt: false,
    ...overrides,
  };
}

function makeTinyText(overrides: Partial<TinyTextDetail> = {}): TinyTextDetail {
  return {
    tag: 'span',
    text: 'Fine print',
    className: 'text-xs',
    fontSize: 10,
    ...overrides,
  };
}

describe('formatResponsiveCheck', () => {
  it('reports no issues when all breakpoints are clean', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 0,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    expect(out).toContain('No responsive issues');
  });

  it('compact mode shows issue count', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'HIGH', message: 'Horizontal overflow detected' }],
          hasHorizontalOverflow: true,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result, { compact: true });
    expect(out).toContain('1 issue');
    expect(out).toContain('375px');
  });

  it('verbose mode includes table and issue list', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [
            { severity: 'HIGH', message: 'Horizontal overflow' },
            { severity: 'MEDIUM', message: '5 touch targets smaller than 44px' },
          ],
          hasHorizontalOverflow: true,
          smallTouchTargets: 5,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [
            makeDetail({ text: 'Home', width: 32, height: 24 }),
            makeDetail({ text: 'About', width: 38, height: 20 }),
            makeDetail({ text: 'Contact', width: 30, height: 22 }),
            makeDetail({ text: 'Blog', width: 36, height: 28 }),
            makeDetail({ text: 'FAQ', width: 34, height: 26 }),
          ],
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 2,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    expect(out).toContain('Breakpoint');
    expect(out).toContain('Issues');
    expect(out).toContain('[HIGH]');
    expect(out).toContain('[MEDIUM]');
  });

  it('shows per-element touch target details in verbose mode', () => {
    const details: TouchTargetDetail[] = [
      makeDetail({
        tag: 'a',
        text: 'Privacy Policy',
        className: 'text-sm text-surface-500',
        width: 38,
        height: 28,
      }),
      makeDetail({
        tag: 'button',
        text: 'Products',
        className: 'py-2 text-sm',
        width: 36,
        height: 20,
      }),
    ];
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'MEDIUM', message: '2 touch targets smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 2,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: details,
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    expect(out).toContain('Touch target 38x28px');
    expect(out).toContain('"Privacy Policy"');
    expect(out).toContain('Touch target 36x20px');
    expect(out).toContain('"Products"');
    expect(out).toContain('text-sm text-surface-500');
    // single-breakpoint findings still carry their breakpoint suffix
    expect(out).toContain('— at 375px');
  });

  it('single-breakpoint findings at 1440 carry the — at 1440px suffix (verbose + compact)', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 1440,
          label: 'Desktop',
          issues: [{ severity: 'MEDIUM', message: '1 touch target smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 1,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [makeDetail({ tag: 'button', text: 'Menu', width: 36, height: 36 })],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const verbose = formatResponsiveCheck(result).split('\n').find((l) => l.includes('Touch target 36x36px'));
    expect(verbose?.endsWith('— at 1440px')).toBe(true);
    const compact = formatResponsiveCheck(result, { compact: true })
      .split('\n')
      .find((l) => l.includes('button 36x36px'));
    expect(compact?.endsWith('— at 1440px')).toBe(true);
  });

  it('separates inline-exempt links from real failures', () => {
    const details: TouchTargetDetail[] = [
      makeDetail({ tag: 'a', text: 'Privacy Policy', width: 38, height: 28, inlineExempt: true }),
      makeDetail({ tag: 'button', text: 'Submit', width: 36, height: 20, inlineExempt: false }),
    ];
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'MEDIUM', message: '1 touch target smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 1,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: details,
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    // Non-exempt shown as failures
    expect(out).toContain('Touch target 36x20px');
    expect(out).toContain('"Submit"');
    // Exempt shown separately
    expect(out).toContain('Inline Text Links');
    expect(out).toContain('"Privacy Policy"');
    expect(out).toContain('inline, likely exempt');
  });

  it('shows tiny text details in verbose mode', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'LOW', message: '2 text elements below 12px font size' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 2,
          pageHeight: 2000,
          touchTargetDetails: [],
          tinyTextDetails: [
            makeTinyText({ tag: 'span', text: 'Copyright 2024', fontSize: 10 }),
            makeTinyText({ tag: 'label', text: 'Required', fontSize: 9.5, className: 'sr-label' }),
          ],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    expect(out).toContain('Tiny Text');
    expect(out).toContain('10px text');
    expect(out).toContain('"Copyright 2024"');
    expect(out).toContain('9.5px text');
  });

  it('uses configurable target size in table display', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'MEDIUM', message: '3 touch targets smaller than 24px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 3,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [
            makeDetail({ width: 20, height: 18 }),
            makeDetail({ width: 22, height: 16 }),
            makeDetail({ width: 18, height: 20 }),
          ],
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 24,
    };
    const out = formatResponsiveCheck(result);
    expect(out).toContain('< 24px');
  });

  it('collapses a touch target recurring across breakpoints into one finding', () => {
    const privacy = (width: number, height: number) =>
      makeDetail({ tag: 'a', text: 'Privacy policy', className: 'footer-link', width, height });
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'MEDIUM', message: '1 touch target smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 1,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [privacy(120, 30)],
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [{ severity: 'MEDIUM', message: '1 touch target smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 1,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [privacy(120, 32)],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 2,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    const matches = out.split('\n').filter((l) => l.includes('"Privacy policy"'));
    expect(matches.length).toBe(1); // not counted once per breakpoint
    expect(matches[0]).toContain('120x30px'); // smallest observed dimensions
    expect(matches[0]).toContain('at 375px, 768px');
  });

  it('compact mode dedups a target recurring across breakpoints', () => {
    const home = (width: number) =>
      makeDetail({ tag: 'a', text: 'Home', className: 'nav', width, height: 30 });
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'MEDIUM', message: '1 touch target smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 1,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [home(40)],
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [{ severity: 'MEDIUM', message: '1 touch target smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 1,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [home(42)],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 2,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result, { compact: true });
    const matches = out.split('\n').filter((l) => l.includes('"Home"'));
    expect(matches.length).toBe(1);
    expect(matches[0]).toContain('at 375px, 768px');
  });

  it('compact mode shows top 5 touch target details', () => {
    const details: TouchTargetDetail[] = Array.from({ length: 8 }, (_, i) =>
      makeDetail({ text: `Link ${i + 1}`, width: 30 + i, height: 20 + i }),
    );
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'MEDIUM', message: '8 touch targets smaller than 44px minimum' }],
          hasHorizontalOverflow: false,
          smallTouchTargets: 8,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: details,
          tinyTextDetails: [],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result, { compact: true });
    // Should show top 5 details
    expect(out).toContain('Link 1');
    expect(out).toContain('Link 5');
    // Should indicate more remaining
    expect(out).toContain('… and 3 more');
    // Should not show all 8
    expect(out).not.toContain('Link 8');
  });

  it('names the horizontal-overflow culprit in verbose mode', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'HIGH', message: 'Horizontal overflow' }],
          hasHorizontalOverflow: true,
          scrollWidth: 525,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [],
          tinyTextDetails: [],
          overflowCulprits: [
            { tag: 'table', right: 525, text: 'Technique | Savings | Effort', className: '' },
          ],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result);
    expect(out).toContain('table right=525px "Technique | Savings | Effort"');
  });

  it('names the horizontal-overflow culprit in compact mode', () => {
    const result: ResponsiveCheckResult = {
      breakpoints: [
        {
          width: 375,
          label: 'Mobile',
          issues: [{ severity: 'HIGH', message: 'Horizontal overflow' }],
          hasHorizontalOverflow: true,
          scrollWidth: 525,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 2000,
          touchTargetDetails: [],
          tinyTextDetails: [],
          overflowCulprits: [
            { tag: 'table', right: 525, text: 'Technique | Savings | Effort', className: '' },
          ],
        },
        {
          width: 768,
          label: 'Tablet',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1800,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
        {
          width: 1440,
          label: 'Desktop',
          issues: [],
          hasHorizontalOverflow: false,
          smallTouchTargets: 0,
          tinyText: 0,
          pageHeight: 1500,
          touchTargetDetails: [],
          tinyTextDetails: [],
        },
      ],
      totalIssues: 1,
      targetSize: 44,
    };
    const out = formatResponsiveCheck(result, { compact: true });
    expect(out).toContain('table right=525px "Technique | Savings | Effort"');
  });
});
