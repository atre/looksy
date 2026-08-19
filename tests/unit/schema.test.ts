import { describe, it, expect } from 'vitest';
import { formatSchema, type SchemaData } from '../../dist/schema.js';

function makeData(overrides: Partial<SchemaData> = {}): SchemaData {
  return {
    blockCount: 1,
    items: [
      {
        type: 'FAQPage',
        properties: { questions: '5' },
        issues: [],
      },
      {
        type: 'Organization',
        properties: { name: 'Test Corp', url: 'https://example.com' },
        issues: [],
      },
    ],
    ...overrides,
  };
}

describe('formatSchema', () => {
  it('compact mode lists types', () => {
    const result = formatSchema(makeData(), { compact: true });
    expect(result).toContain('## Schema (2): FAQPage, Organization');
  });

  it('compact mode shows issue count', () => {
    const data = makeData({
      items: [{ type: 'Article', properties: {}, issues: ['missing author', 'missing datePublished'] }],
    });
    const result = formatSchema(data, { compact: true });
    expect(result).toContain('2 issues');
  });

  it('verbose mode includes properties', () => {
    const result = formatSchema(makeData());
    expect(result).toContain('## JSON-LD Schema');
    expect(result).toContain('### FAQPage');
    expect(result).toContain('questions');
    expect(result).toContain('### Organization');
    expect(result).toContain('Test Corp');
  });

  it('returns short message when no schema', () => {
    const result = formatSchema({ blockCount: 0, items: [] });
    expect(result).toContain('no JSON-LD found');
  });
});
