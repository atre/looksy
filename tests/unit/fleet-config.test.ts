import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFleetConfig, expandFleetTargets } from '../../src/fleet-config.js';
import { configureFleet } from '../../src/cli-utils.js';

describe('loadFleetConfig / expandFleetTargets', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'looksy-fleet-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses inline lists and expands domains x pages', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(
      path,
      'domains: [a.com, b.com]\npages: [/, /about]\nlocales: [en, de]\nviewports: [mobile]\n',
      'utf-8',
    );
    const cfg = loadFleetConfig(path);
    expect(cfg.domains).toEqual(['a.com', 'b.com']);
    expect(cfg.pages).toEqual(['/', '/about']);
    expect(cfg.locales).toEqual(['en', 'de']);
    expect(cfg.viewports).toEqual(['mobile']);
    expect(expandFleetTargets(cfg)).toEqual([
      'https://a.com/',
      'https://a.com/about',
      'https://b.com/',
      'https://b.com/about',
    ]);
  });

  it('parses block-style `- item` lists', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, 'domains:\n  - a.com\n  - b.com\npages:\n  - /\n  - /pricing\n', 'utf-8');
    const cfg = loadFleetConfig(path);
    expect(cfg.domains).toEqual(['a.com', 'b.com']);
    expect(expandFleetTargets(cfg)).toEqual([
      'https://a.com/',
      'https://a.com/pricing',
      'https://b.com/',
      'https://b.com/pricing',
    ]);
  });

  it('defaults pages to "/" when omitted', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, 'domains: [a.com]\n', 'utf-8');
    const cfg = loadFleetConfig(path);
    expect(expandFleetTargets(cfg)).toEqual(['https://a.com/']);
  });

  it('ignores comments and blank lines', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, '# fleet config\ndomains: [a.com] # prod domains\n\npages: [/]\n', 'utf-8');
    const cfg = loadFleetConfig(path);
    expect(cfg.domains).toEqual(['a.com']);
    expect(cfg.pages).toEqual(['/']);
  });

  it('throws when the file does not exist', () => {
    expect(() => loadFleetConfig(join(dir, 'missing.yaml'))).toThrow(/not found/);
  });

  it('throws when domains is missing', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, 'pages: [/]\n', 'utf-8');
    expect(() => loadFleetConfig(path)).toThrow(/no domains/);
  });
});

describe('configureFleet fleet.yaml fallback', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'looksy-fleet-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads --fleet <path> when no URLs were given, and maps viewports:[mobile] to --mobile', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(
      path,
      'domains: [a.com, b.com]\npages: [/, /about]\nviewports: [mobile]\n',
      'utf-8',
    );
    const values: Record<string, any> = { fleet: path };
    const urls = configureFleet([], values);
    expect(urls).toEqual([
      'https://a.com/',
      'https://a.com/about',
      'https://b.com/',
      'https://b.com/about',
    ]);
    expect(values.urls).toBe(
      'https://a.com/,https://a.com/about,https://b.com/,https://b.com/about',
    );
    expect(values.mobile).toBe(true);
  });

  it('maps viewports:[mobile,desktop] to --multi', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, 'domains: [a.com]\nviewports: [mobile, desktop]\n', 'utf-8');
    const values: Record<string, any> = { fleet: path };
    configureFleet([], values);
    expect(values.multi).toBe(true);
    expect(values.mobile).toBeUndefined();
  });

  it('explicit URLs skip the fleet.yaml fallback entirely', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, 'domains: [a.com]\nviewports: [mobile]\n', 'utf-8');
    const values: Record<string, any> = { fleet: path };
    const urls = configureFleet(['https://c.com'], values);
    expect(urls).toEqual(['https://c.com']);
    expect(values.mobile).toBeUndefined();
  });

  it('an explicit --mobile flag is not clobbered by fleet.yaml', () => {
    const path = join(dir, 'fleet.yaml');
    writeFileSync(path, 'domains: [a.com]\nviewports: [desktop]\n', 'utf-8');
    const values: Record<string, any> = { fleet: path, mobile: true };
    configureFleet([], values);
    expect(values.mobile).toBe(true);
  });
});
