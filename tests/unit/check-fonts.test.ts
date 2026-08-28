import { describe, it, expect } from 'vitest';

// Unit tests for check.ts font assertions (self-hosted-fonts, no-google-fonts).
// These test the Node.js-side logic that runs before page.evaluate,
// by simulating the FontSourcesData structure that extractFontSources returns.

// Mirror the FontSourcesData shape used by the check logic
interface FontSource {
  url: string;
  family: string;
  format: string;
  external: boolean;
}

interface FontSourcesData {
  sources: FontSource[];
  externalDomains: string[];
}

// Helpers that replicate the check logic from check.ts
function checkSelfHostedFonts(fontData: FontSourcesData): { pass: boolean; detail: string } {
  if (fontData.externalDomains.length === 0) {
    return { pass: true, detail: `all ${fontData.sources.length} font(s) self-hosted` };
  }
  return { pass: false, detail: `external font domain(s) found: ${fontData.externalDomains.join(', ')}` };
}

function checkNoGoogleFonts(fontData: FontSourcesData): { pass: boolean; detail: string } {
  const googleDomains = fontData.externalDomains.filter(
    (d) => d === 'fonts.googleapis.com' || d === 'fonts.gstatic.com',
  );
  const googleSources = fontData.sources.filter(
    (s) => s.url.includes('fonts.googleapis.com') || s.url.includes('fonts.gstatic.com'),
  );
  if (googleDomains.length === 0 && googleSources.length === 0) {
    return { pass: true, detail: 'no Google Fonts URLs detected' };
  }
  const domains = [
    ...new Set([
      ...googleDomains,
      ...googleSources.map((s) => { try { return new URL(s.url).hostname; } catch { return s.url; } }),
    ]),
  ];
  return { pass: false, detail: `Google Fonts detected: ${domains.join(', ')}` };
}

describe('check: self-hosted-fonts', () => {
  it('passes when no font sources are found (no fonts at all)', () => {
    const data: FontSourcesData = { sources: [], externalDomains: [] };
    const result = checkSelfHostedFonts(data);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('self-hosted');
  });

  it('passes when all fonts are self-hosted', () => {
    const data: FontSourcesData = {
      sources: [
        { url: '/fonts/inter.woff2', family: 'Inter', format: 'woff2', external: false },
        { url: '/fonts/dm-sans.woff2', family: 'DM Sans', format: 'woff2', external: false },
      ],
      externalDomains: [],
    };
    const result = checkSelfHostedFonts(data);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('2 font(s) self-hosted');
  });

  it('fails when fonts.googleapis.com is found', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.googleapis.com/css2?family=Inter', family: '', format: 'stylesheet', external: true },
      ],
      externalDomains: ['fonts.googleapis.com'],
    };
    const result = checkSelfHostedFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.googleapis.com');
  });

  it('fails when fonts.gstatic.com is found', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3Fw.woff2', family: 'Inter', format: 'woff2', external: true },
      ],
      externalDomains: ['fonts.gstatic.com'],
    };
    const result = checkSelfHostedFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.gstatic.com');
  });

  it('fails when any CDN font domain is found (non-Google)', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.bunny.net/css?family=inter', family: '', format: 'stylesheet', external: true },
      ],
      externalDomains: ['fonts.bunny.net'],
    };
    const result = checkSelfHostedFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.bunny.net');
  });

  it('fails and lists multiple external domains', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.googleapis.com/css2?family=Inter', family: '', format: 'stylesheet', external: true },
        { url: 'https://use.typekit.net/abc.css', family: '', format: 'stylesheet', external: true },
      ],
      externalDomains: ['fonts.googleapis.com', 'use.typekit.net'],
    };
    const result = checkSelfHostedFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.googleapis.com');
    expect(result.detail).toContain('use.typekit.net');
  });
});

describe('check: no-google-fonts', () => {
  it('passes when no font sources at all', () => {
    const data: FontSourcesData = { sources: [], externalDomains: [] };
    const result = checkNoGoogleFonts(data);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('no Google Fonts');
  });

  it('passes when fonts are self-hosted only', () => {
    const data: FontSourcesData = {
      sources: [
        { url: '/fonts/inter.woff2', family: 'Inter', format: 'woff2', external: false },
      ],
      externalDomains: [],
    };
    const result = checkNoGoogleFonts(data);
    expect(result.pass).toBe(true);
  });

  it('passes when only non-Google external CDN is used', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.bunny.net/css?family=inter', family: '', format: 'stylesheet', external: true },
      ],
      externalDomains: ['fonts.bunny.net'],
    };
    const result = checkNoGoogleFonts(data);
    // bunny.net is not Google Fonts — passes no-google-fonts
    expect(result.pass).toBe(true);
  });

  it('fails when fonts.googleapis.com is in external domains', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.googleapis.com/css2?family=Inter', family: '', format: 'stylesheet', external: true },
      ],
      externalDomains: ['fonts.googleapis.com'],
    };
    const result = checkNoGoogleFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.googleapis.com');
  });

  it('fails when fonts.gstatic.com is in external domains', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3.woff2', family: 'Inter', format: 'woff2', external: true },
      ],
      externalDomains: ['fonts.gstatic.com'],
    };
    const result = checkNoGoogleFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.gstatic.com');
  });

  it('fails when fonts.googleapis.com url is in sources but not externalDomains', () => {
    // Edge case: source URL contains googleapis.com but it wasn't extracted into externalDomains
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.googleapis.com/css2?family=Roboto', family: '', format: 'stylesheet', external: true },
      ],
      externalDomains: [], // missing from externalDomains for some reason
    };
    const result = checkNoGoogleFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.googleapis.com');
  });

  it('fails when both googleapis and gstatic are found', () => {
    const data: FontSourcesData = {
      sources: [
        { url: 'https://fonts.googleapis.com/css2?family=Inter', family: '', format: 'stylesheet', external: true },
        { url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3.woff2', family: 'Inter', format: 'woff2', external: true },
      ],
      externalDomains: ['fonts.googleapis.com', 'fonts.gstatic.com'],
    };
    const result = checkNoGoogleFonts(data);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('fonts.googleapis.com');
    expect(result.detail).toContain('fonts.gstatic.com');
  });
});
