import { describe, it, expect } from 'vitest';
import { formatContrastSummary } from '../../dist/cli.js';

describe('formatContrastSummary', () => {
  it('prints the URL, not the PNG path', () => {
    const lines = formatContrastSummary(
      [
        {
          url: 'https://a.com/',
          result: { imagePath: '/tmp/x.png', contrastFailures: { aa: 2, aaa: 5 } },
        },
      ],
      'URLs',
    );
    expect(lines.some((l) => l.startsWith('  https://a.com/: 2 AA, 5 AAA'))).toBe(true);
    expect(lines.some((l) => l.includes('/tmp/x.png'))).toBe(false);
  });

  it('totals AA/AAA failures across entries', () => {
    const lines = formatContrastSummary(
      [
        {
          url: 'https://a.com/',
          result: { imagePath: '/tmp/a.png', contrastFailures: { aa: 2, aaa: 5 } },
        },
        {
          url: 'https://b.com/',
          result: { imagePath: '/tmp/b.png', contrastFailures: { aa: 1, aaa: 0 } },
        },
      ],
      'URLs',
    );
    expect(lines.some((l) => l.includes('AA failures: 3 total | AAA failures: 5 total'))).toBe(
      true,
    );
  });

  it('omits entries with no failures from the per-URL list', () => {
    const lines = formatContrastSummary(
      [
        {
          url: 'https://a.com/',
          result: { imagePath: '/tmp/a.png', contrastFailures: { aa: 0, aaa: 0 } },
        },
      ],
      'URLs',
    );
    expect(lines.some((l) => l.includes('https://a.com/:'))).toBe(false);
  });
});
