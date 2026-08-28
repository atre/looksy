import { describe, it, expect } from 'vitest';
import { loadDesignSpec, formatDesignValidation, type DesignValidationResult } from '../../src/design-spec.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadDesignSpec', () => {
  it('loads a valid design spec JSON', () => {
    const specPath = join(tmpdir(), 'test-design-spec.json');
    writeFileSync(specPath, JSON.stringify({
      fonts: { h1: 'Archivo Black', body: 'DM Sans' },
      colors: { '.hero bg': '#3D3D3D', 'h1': '#ffffff' },
      spacing: { 'section padding-top': '64px' },
    }));
    const spec = loadDesignSpec(specPath);
    expect(spec.fonts).toBeDefined();
    expect(spec.fonts!['h1']).toBe('Archivo Black');
    expect(spec.colors).toBeDefined();
    expect(spec.spacing).toBeDefined();
    unlinkSync(specPath);
  });
});

describe('formatDesignValidation', () => {
  const results: DesignValidationResult[] = [
    { assertion: 'font h1 = Archivo Black', category: 'font', selector: 'h1', property: 'font-family', expected: 'Archivo Black', actual: 'Archivo Black', pass: true },
    { assertion: 'color .hero bg = #3D3D3D', category: 'color', selector: '.hero', property: 'background-color', expected: '#3D3D3D', actual: '#1a1a1a', pass: false },
    { assertion: 'section padding-top = 64px', category: 'spacing', selector: 'section', property: 'padding-top', expected: '64px', actual: '32px', pass: false },
  ];

  it('formats compact mode', () => {
    const text = formatDesignValidation(results, { compact: true });
    expect(text).toContain('2/3 fail');
    expect(text).toContain('[FAIL]');
  });

  it('formats full mode with categories', () => {
    const text = formatDesignValidation(results);
    expect(text).toContain('## Design Spec Validation');
    expect(text).toContain('### Fonts');
    expect(text).toContain('### Colors');
    expect(text).toContain('### Spacings');
    expect(text).toContain('[PASS]');
    expect(text).toContain('[FAIL]');
  });

  it('formats all-pass results', () => {
    const passing = [results[0]];
    const text = formatDesignValidation(passing, { compact: true });
    expect(text).toContain('all 1 checks pass');
  });
});
