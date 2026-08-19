import { describe, it, expect } from 'vitest';
import {
  formatCacheAudit,
  classifyCacheEntry,
  type CacheAuditData,
} from '../../src/cache-audit.js';

const sampleData: CacheAuditData = {
  entries: [
    {
      name: 'main-abc.js',
      url: '',
      type: 'script',
      transferSize: 50000,
      cacheControl: 'immutable (cached)',
      encoding: 'br',
      ttl: 31536000,
      issue: null,
    },
    {
      name: 'style.css',
      url: '',
      type: 'link',
      transferSize: 10000,
      cacheControl: 'should be immutable',
      encoding: 'gzip',
      ttl: null,
      issue: 'hashed asset not cached',
    },
    {
      name: 'index.html',
      url: '',
      type: 'navigation',
      transferSize: 5000,
      cacheControl: 'no-cache',
      encoding: 'gzip',
      ttl: null,
      issue: null,
    },
  ],
  totalResources: 3,
  noCacheCount: 1,
  shortTtlCount: 0,
  immutableCount: 1,
  issues: [{ severity: 'high', message: '1 static asset(s) not served from cache' }],
};

describe('formatCacheAudit', () => {
  it('shows empty message when no resources', () => {
    const result = formatCacheAudit({
      entries: [],
      totalResources: 0,
      noCacheCount: 0,
      shortTtlCount: 0,
      immutableCount: 0,
      issues: [],
    });
    expect(result).toContain('No resources');
  });

  it('compact mode shows summary', () => {
    const result = formatCacheAudit(sampleData, { compact: true });
    expect(result).toContain('3 resources');
    expect(result).toContain('1 immutable');
  });

  it('verbose mode shows issues table', () => {
    const result = formatCacheAudit(sampleData);
    expect(result).toContain('Cache Audit');
    expect(result).toContain('hashed asset not cached');
    expect(result).toContain('Recommendations');
  });
});

describe('classifyCacheEntry', () => {
  it('treats immutable/long max-age as cached OK', () => {
    const result = classifyCacheEntry(
      { name: 'chunk.a1b2c3.js', transferSize: 1200, decodedBodySize: 4000, isHashed: true },
      'public, max-age=31536000, immutable',
    );
    expect(result.issue).toBeNull();
    expect(result.cacheControl).toBe('immutable (cached)');
  });

  it('flags a hashed asset with a sub-24h max-age as short-ttl', () => {
    const result = classifyCacheEntry(
      { name: 'a.b1c2d3.css', transferSize: 900, decodedBodySize: 900, isHashed: true },
      'public, max-age=14400',
    );
    expect(result.issue).toBe('hashed asset short-ttl (4h)');
  });

  it('never flags a 0/0 entry (opaque/aborted/redirect) as an issue', () => {
    const result = classifyCacheEntry(
      { name: 'x.png', transferSize: 0, decodedBodySize: 0 },
      undefined,
    );
    expect(result.issue).toBeNull();
  });

  it('a memory/disk cache hit with no header seen is not a false-positive no-cache', () => {
    // This is the bug: transferSize=0 + no header must not read as "no-cache".
    const result = classifyCacheEntry(
      { name: 'app.abc123.js', transferSize: 0, decodedBodySize: 4000, isHashed: true },
      undefined,
    );
    expect(result.issue).toBeNull();
  });

  it('flags a static asset with no cache-control header at all and real transfer as no-cache', () => {
    const result = classifyCacheEntry(
      { name: 'hero.webp', transferSize: 40000, decodedBodySize: 40000, isStatic: true },
      undefined,
    );
    expect(result.issue).toBe('no-cache');
  });

  it('does not flag a non-static resource with no header as no-cache', () => {
    const result = classifyCacheEntry(
      { name: 'analytics-beacon', transferSize: 200, decodedBodySize: 200 },
      undefined,
    );
    expect(result.issue).toBeNull();
  });

  it('a present-but-restrictive header on a non-hashed asset is trusted, not flagged', () => {
    // Header was seen at all, so the transferSize heuristic never applies here.
    const result = classifyCacheEntry(
      { name: 'api-response.json', transferSize: 300, decodedBodySize: 300, isStatic: false },
      'no-store',
    );
    expect(result.issue).toBeNull();
  });
});
