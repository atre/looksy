import { describe, it, expect } from 'vitest';
import { formatClassAudit, type ClassAuditData } from '../../dist/class-audit.js';

function makeData(overrides: Partial<ClassAuditData> = {}): ClassAuditData {
  return {
    totalClasses: 10,
    classes: ['btn', 'btn-primary', 'container', 'flex', 'grid', 'hero', 'nav', 'footer', 'card', 'text-lg'],
    hashedClasses: ['astro-xyz123abc', '_astro_abc123'],
    topClasses: [
      { name: 'flex', count: 15 },
      { name: 'btn', count: 8 },
    ],
    topCombos: [],
    ...overrides,
  };
}

describe('formatClassAudit', () => {
  it('compact mode produces one-liner with hashed count', () => {
    const result = formatClassAudit(makeData(), { compact: true });
    expect(result).toContain('## Class Audit: 10 unique classes');
    expect(result).toContain('2 hashed');
  });

  it('compact mode with no hashed classes omits hash info', () => {
    const result = formatClassAudit(makeData({ hashedClasses: [] }), { compact: true });
    expect(result).toContain('## Class Audit: 10 unique classes');
    expect(result).not.toContain('hashed');
  });

  it('verbose mode includes tables and hashed list', () => {
    const result = formatClassAudit(makeData());
    expect(result).toContain('## Class Audit');
    expect(result).toContain('Generated/Hashed Classes');
    expect(result).toContain('astro-xyz123abc');
    expect(result).toContain('Most Used Classes');
  });

  it('returns short message when no classes', () => {
    const result = formatClassAudit(makeData({ totalClasses: 0 }));
    expect(result).toContain('no classes found');
  });

  it('verbose mode lists recurring class combos when present', () => {
    const data = makeData({
      topCombos: [
        { combo: 'flex items-center p-4', count: 12, classCount: 3 },
        { combo: 'btn btn-primary text-lg', count: 4, classCount: 3 },
      ],
    });
    const result = formatClassAudit(data);
    expect(result).toContain('Recurring Class Combinations');
    expect(result).toContain('flex items-center p-4');
    expect(result).toContain('| 12 |');
  });

  it('compact mode mentions recurring combos when present', () => {
    const data = makeData({
      topCombos: [{ combo: 'flex items-center', count: 8, classCount: 2 }],
    });
    const result = formatClassAudit(data, { compact: true });
    expect(result).toContain('1 recurring combo');
    expect(result).toContain('top: 8x');
  });
});
