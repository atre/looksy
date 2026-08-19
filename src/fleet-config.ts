import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FleetConfig {
  domains: string[];
  pages?: string[];
  locales?: string[];
  viewports?: ('mobile' | 'desktop')[];
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseInlineList(raw: string): string[] {
  const inner = raw
    .trim()
    .replace(/^\[/, '')
    .replace(/\]\s*$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((s) => stripQuotes(s.trim()))
    .filter(Boolean);
}

/**
 * Zero-dep YAML subset: top-level `key: value`, `key: [a, b]` inline lists, and
 * `key:` followed by `- item` block lists. No nesting, no multi-line scalars.
 */
function parseMinimalYaml(text: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\r$/, '');
    if (!line.trim()) continue;

    const itemMatch = line.match(/^\s*-\s*(.+)$/);
    if (itemMatch && currentKey) {
      result[currentKey].push(stripQuotes(itemMatch[1].trim()));
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      const value = rawValue.trim();
      if (!value) {
        currentKey = key;
        result[key] = [];
      } else if (value.startsWith('[')) {
        result[key] = parseInlineList(value);
        currentKey = null;
      } else {
        result[key] = [stripQuotes(value)];
        currentKey = null;
      }
    }
  }

  return result;
}

/** Read fleet.yaml (shared schema with peep/texter/trusty): domains, pages, locales, viewports. */
export function loadFleetConfig(path = './fleet.yaml'): FleetConfig {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`looksy: fleet config not found: ${resolved}`);
  }
  const parsed = parseMinimalYaml(readFileSync(resolved, 'utf-8'));
  const domains = parsed.domains ?? [];
  if (domains.length === 0) {
    throw new Error(`looksy: fleet config ${resolved} has no domains`);
  }

  const cfg: FleetConfig = { domains };
  if (parsed.pages) cfg.pages = parsed.pages;
  if (parsed.locales) cfg.locales = parsed.locales;
  if (parsed.viewports) cfg.viewports = parsed.viewports as ('mobile' | 'desktop')[];
  return cfg;
}

function normalizeDomain(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain.replace(/\/+$/, '') : `https://${domain}`;
}

function joinDomainPage(domain: string, page: string): string {
  const path = page.startsWith('/') ? page : `/${page}`;
  return `${domain}${path}`;
}

/** domains x pages cross-product. `locales` is ignored — pages already carry locale prefixes. */
export function expandFleetTargets(cfg: FleetConfig): string[] {
  const domains = cfg.domains.map(normalizeDomain);
  const pages = cfg.pages && cfg.pages.length > 0 ? cfg.pages : ['/'];
  const targets: string[] = [];
  for (const domain of domains) {
    for (const page of pages) {
      targets.push(joinDomainPage(domain, page));
    }
  }
  return targets;
}
