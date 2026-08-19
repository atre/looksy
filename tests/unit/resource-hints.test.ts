import { describe, it, expect } from 'vitest';
import { formatResourceHints, type ResourceHintsData } from '../../src/resource-hints.js';

const sampleData: ResourceHintsData = {
  existing: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preload', href: '/fonts/inter.woff2', as: 'font' },
  ],
  missingPreconnects: ['https://cdn.example.com', 'https://api.stripe.com'],
  unusedPreloads: ['https://example.com/unused.js'],
  missingPreloads: [
    { type: 'LCP image', url: 'hero.jpg', reason: 'LCP element resource should be preloaded' },
  ],
};

describe('formatResourceHints', () => {
  it('compact mode shows hint count and suggestions', () => {
    const result = formatResourceHints(sampleData, { compact: true });
    expect(result).toContain('2 hints');
    expect(result).toContain('4 suggestions');
  });

  it('verbose mode shows all sections', () => {
    const result = formatResourceHints(sampleData);
    expect(result).toContain('Resource Hints');
    expect(result).toContain('Existing Hints');
    expect(result).toContain('preconnect');
    expect(result).toContain('Missing Preconnects');
    expect(result).toContain('cdn.example.com');
    expect(result).toContain('Unused Preloads');
    expect(result).toContain('Suggested Preloads');
    expect(result).toContain('LCP image');
  });

  it('shows no issues when clean', () => {
    const clean: ResourceHintsData = { existing: [{ rel: 'preconnect', href: 'https://example.com' }], missingPreconnects: [], unusedPreloads: [], missingPreloads: [] };
    const result = formatResourceHints(clean);
    expect(result).toContain('No issues');
  });
});
