import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveUrl,
  resolveViewport,
  applySuffix,
  validateNumeric,
  validateFloat,
  parseHostResolverRule,
  combineInject,
  resolveOutputTarget,
  urlToOutputSuffix,
} from '../../dist/cli.js';

describe('resolveUrl', () => {
  it('passes through https URLs', () => {
    expect(resolveUrl('https://example.com')).toBe('https://example.com');
  });

  it('passes through http URLs', () => {
    expect(resolveUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('passes through file:// URLs', () => {
    expect(resolveUrl('file:///tmp/test.html')).toBe('file:///tmp/test.html');
  });

  it('prepends http:// to localhost', () => {
    expect(resolveUrl('localhost:3000')).toBe('http://localhost:3000');
  });

  it('prepends http://localhost to bare :port', () => {
    expect(resolveUrl(':8080')).toBe('http://localhost:8080');
  });

  it('converts file paths to file:// URLs', () => {
    // Use a path that exists on all systems
    const url = resolveUrl('/tmp');
    expect(url).toBe('file:///tmp');
  });

  it('prepends https:// to bare domains', () => {
    expect(resolveUrl('example.com')).toBe('https://example.com');
  });

  it('prepends https:// to domains with paths', () => {
    expect(resolveUrl('example.com/page')).toBe('https://example.com/page');
  });

  it('throws on whitespace (unquoted zsh array collapsed into one arg)', () => {
    expect(() => resolveUrl('https://a.com/ https://a.com/de/')).toThrow(
      /did you mean separate args/,
    );
  });

  it('still resolves bare domains after the whitespace check', () => {
    expect(resolveUrl('example.com')).toBe('https://example.com');
  });
});

describe('resolveViewport', () => {
  it('returns desktop defaults with no flags', () => {
    expect(resolveViewport({})).toEqual({ width: 1280, height: 800 });
  });

  it('returns mobile viewport', () => {
    expect(resolveViewport({ mobile: true })).toEqual({ width: 390, height: 844 });
  });

  it('returns tablet viewport', () => {
    expect(resolveViewport({ tablet: true })).toEqual({ width: 768, height: 1024 });
  });

  it('overrides width only', () => {
    expect(resolveViewport({ width: '1440' })).toEqual({ width: 1440, height: 800 });
  });

  it('overrides height only', () => {
    expect(resolveViewport({ height: '900' })).toEqual({ width: 1280, height: 900 });
  });

  it('overrides both width and height', () => {
    expect(resolveViewport({ width: '1440', height: '900' })).toEqual({ width: 1440, height: 900 });
  });
});

describe('applySuffix', () => {
  it('appends suffix before extension', () => {
    expect(applySuffix('/tmp/looksy/preview.png', 'hero')).toBe('/tmp/looksy/preview-hero.png');
  });

  it('returns path unchanged when no suffix', () => {
    expect(applySuffix('/tmp/looksy/preview.png', undefined)).toBe('/tmp/looksy/preview.png');
  });

  it('returns path unchanged for empty suffix', () => {
    expect(applySuffix('/tmp/looksy/preview.png', '')).toBe('/tmp/looksy/preview.png');
  });

  it('sanitizes unsafe characters', () => {
    expect(applySuffix('/tmp/looksy/preview.png', 'my section!')).toBe(
      '/tmp/looksy/preview-my-section-.png',
    );
  });

  it('works with jpeg extension', () => {
    expect(applySuffix('/tmp/looksy/preview.jpg', 'hero')).toBe('/tmp/looksy/preview-hero.jpg');
  });

  it('works with pdf extension', () => {
    expect(applySuffix('/tmp/looksy/preview.pdf', 'report')).toBe('/tmp/looksy/preview-report.pdf');
  });
});

describe('validateNumeric', () => {
  it('returns parsed number for valid input', () => {
    expect(validateNumeric('wait', '500')).toBe(500);
  });

  it('returns parsed number for zero', () => {
    expect(validateNumeric('width', '0')).toBe(0);
  });
});

describe('validateFloat', () => {
  it('accepts decimals', () => {
    expect(validateFloat('threshold', '0.5')).toBe(0.5);
  });

  it('accepts zero', () => {
    expect(validateFloat('threshold', '0')).toBe(0);
  });
});

describe('combineInject', () => {
  it('returns undefined when neither inject nor ignore given', () => {
    expect(combineInject(undefined, undefined)).toBeUndefined();
  });

  it('passes through inject alone', () => {
    expect(combineInject('body{color:red}', undefined)).toBe('body{color:red}');
  });

  it('builds mask CSS from --ignore selectors', () => {
    expect(combineInject(undefined, '.ad, .timestamp')).toBe(
      '.ad, .timestamp { visibility: hidden !important; }',
    );
  });

  it('appends mask CSS after inject CSS', () => {
    expect(combineInject('body{color:red}', '.ad')).toBe(
      'body{color:red}\n.ad { visibility: hidden !important; }',
    );
  });

  it('ignores empty selector fragments', () => {
    expect(combineInject(undefined, ' , ,')).toBeUndefined();
  });
});

describe('resolveOutputTarget', () => {
  it('returns empty object for undefined', () => {
    expect(resolveOutputTarget(undefined)).toEqual({});
  });

  it('treats a trailing slash as a directory target', () => {
    expect(resolveOutputTarget('fleet-mobile/')).toEqual({ dir: 'fleet-mobile' });
  });

  it('treats a plain path as a file target', () => {
    expect(resolveOutputTarget('/tmp/x.png')).toEqual({ file: '/tmp/x.png' });
  });

  it('treats an existing directory as a directory target even without a trailing slash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'looksy-test-'));
    try {
      expect(resolveOutputTarget(dir)).toEqual({ dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('urlToOutputSuffix', () => {
  it('slugs host + path', () => {
    expect(urlToOutputSuffix('https://a.com/de/')).toBe('a-com-de');
  });

  it('uses host only for the root path', () => {
    expect(urlToOutputSuffix('https://a.com/')).toBe('a-com');
  });

  it('feeds into <dir>/preview-<slug>.png for fleet/--urls directory mode', () => {
    const target = resolveOutputTarget('fleet-mobile/');
    const suffix = urlToOutputSuffix('https://a.com/de/');
    expect(join(target.dir!, `preview-${suffix}.png`)).toBe(
      join('fleet-mobile', 'preview-a-com-de.png'),
    );
  });
});

describe('parseHostResolverRule', () => {
  it('splits domain:ip', () => {
    expect(parseHostResolverRule('staging.example.com:203.0.113.5')).toEqual({
      domain: 'staging.example.com',
      ip: '203.0.113.5',
    });
  });

  it('splits on the first colon only, so an IPv6 target still works', () => {
    expect(parseHostResolverRule('staging.example.com:2606:4700:4700::1111')).toEqual({
      domain: 'staging.example.com',
      ip: '2606:4700:4700::1111',
    });
  });

  it('throws when there is no colon', () => {
    expect(() => parseHostResolverRule('staging.example.com')).toThrow(/domain:ip/);
  });

  it('throws when the domain side is empty', () => {
    expect(() => parseHostResolverRule(':203.0.113.5')).toThrow(/domain:ip/);
  });

  it('throws when the ip side is empty', () => {
    expect(() => parseHostResolverRule('staging.example.com:')).toThrow(/domain:ip/);
  });
});
