import { Resolver } from 'node:dns/promises';

/** Chromium net-error codes that mean "the OS resolver couldn't find this host". */
const NAME_NOT_RESOLVED_RE = /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/;

/** True if a Playwright/Chromium navigation error is a DNS name-resolution failure. */
export function isNameNotResolvedError(message: string): boolean {
  return NAME_NOT_RESOLVED_RE.test(message);
}

/**
 * Look up `hostname` against a public resolver, bypassing whatever the OS resolver has
 * cached. Used to diagnose stale-DNS: Chromium (which always uses the OS resolver) reports
 * NXDOMAIN while the public internet already sees the record — typical right after a
 * domain cutover, before the local resolver's stale negative cache/TTL expires.
 */
export async function resolvesPublicly(
  hostname: string,
  publicDnsServer = '1.1.1.1',
): Promise<boolean> {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers([publicDnsServer]);
  try {
    const addrs = await resolver.resolve4(hostname);
    if (addrs.length > 0) return true;
  } catch {
    /* fall through to AAAA */
  }
  try {
    const addrs = await resolver.resolve6(hostname);
    return addrs.length > 0;
  } catch {
    return false;
  }
}

/**
 * Build an actionable hint when navigation failed with a name-not-resolved error and the
 * hostname turns out to resolve fine against public DNS — i.e. the domain is fine, the
 * OS resolver Chromium uses is just stale. Returns null when the error isn't DNS-shaped,
 * the URL has no parseable hostname, or public DNS can't resolve it either (a real
 * NXDOMAIN, not a stale-cache mismatch).
 */
export async function diagnoseDnsFailure(
  url: string,
  errorMessage: string,
): Promise<string | null> {
  if (!isNameNotResolvedError(errorMessage)) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!hostname) return null;

  const ok = await resolvesPublicly(hostname);
  if (!ok) return null;

  return (
    `looksy: local resolver returned NXDOMAIN for "${hostname}" but 1.1.1.1 resolves it — ` +
    `this looks like a stale DNS cache, not a dead domain. Flush your resolver cache, or bypass ` +
    `it for this run with --host-resolver ${hostname}:<ip>`
  );
}
