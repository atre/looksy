import { describe, it, expect } from 'vitest';
import {
  isNameNotResolvedError,
  resolvesPublicly,
  diagnoseDnsFailure,
} from '../../dist/dns-check.js';

describe('isNameNotResolvedError', () => {
  it('matches ERR_NAME_NOT_RESOLVED', () => {
    expect(
      isNameNotResolvedError('net::ERR_NAME_NOT_RESOLVED at https://staging.example.com/'),
    ).toBe(true);
  });

  it('matches ERR_NAME_RESOLUTION_FAILED', () => {
    expect(
      isNameNotResolvedError('net::ERR_NAME_RESOLUTION_FAILED at https://staging.example.com/'),
    ).toBe(true);
  });

  it('does not match unrelated navigation errors', () => {
    expect(isNameNotResolvedError('net::ERR_CONNECTION_REFUSED at http://localhost:3000/')).toBe(
      false,
    );
  });

  it('does not match a timeout error', () => {
    expect(isNameNotResolvedError('Timeout 30000ms exceeded.')).toBe(false);
  });
});

// Real network lookups against 1.1.1.1 — same "hits the real internet" tradeoff the
// smoke suite already makes for https://example.com.
describe('resolvesPublicly', () => {
  it('resolves a real, long-lived domain', async () => {
    expect(await resolvesPublicly('example.com')).toBe(true);
  }, 10_000);

  it('returns false for a domain that does not exist', async () => {
    expect(await resolvesPublicly('this-domain-should-not-exist-looksy-test.invalid')).toBe(false);
  }, 10_000);
});

describe('diagnoseDnsFailure', () => {
  it('returns null when the error is not DNS-shaped', async () => {
    const hint = await diagnoseDnsFailure('https://example.com/', 'net::ERR_CONNECTION_REFUSED');
    expect(hint).toBeNull();
  });

  it('returns null when the URL has no parseable hostname', async () => {
    const hint = await diagnoseDnsFailure('not a url', 'net::ERR_NAME_NOT_RESOLVED');
    expect(hint).toBeNull();
  });

  it('returns null for a genuinely nonexistent domain (real NXDOMAIN, not a stale-cache mismatch)', async () => {
    const hint = await diagnoseDnsFailure(
      'https://this-domain-should-not-exist-looksy-test.invalid/',
      'net::ERR_NAME_NOT_RESOLVED at https://this-domain-should-not-exist-looksy-test.invalid/',
    );
    expect(hint).toBeNull();
  }, 10_000);

  it('returns an actionable hint when public DNS resolves a host Chromium reported as NXDOMAIN', async () => {
    const hint = await diagnoseDnsFailure(
      'https://example.com/',
      'net::ERR_NAME_NOT_RESOLVED at https://example.com/',
    );
    expect(hint).toContain('example.com');
    expect(hint).toContain('--host-resolver');
  }, 10_000);
});
