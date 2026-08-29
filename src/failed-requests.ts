export interface FailedRequest {
  url: string;
  status?: number;
  error?: string;
  type: string;
}

const TRACKED = new Set(['stylesheet', 'script', 'image', 'font']);

export function isTrackedAssetType(t: string): boolean {
  return TRACKED.has(t);
}

export function isSameOrigin(url: string, pageUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

export function formatFailedRequests(list: FailedRequest[]): string {
  const f = list[0];
  return `⚠ ${list.length} asset(s) failed (first: ${f.url} — ${f.status ?? f.error ?? 'failed'})`;
}

export function classifyBrokenImage(
  src: string,
  failed: FailedRequest[],
): { kind: 'failed' | 'blocked'; reason: string } {
  const hit = failed.find((f) => f.url === src);
  if (hit) return { kind: 'failed', reason: String(hit.status ?? hit.error ?? 'failed') };
  return { kind: 'blocked', reason: 'blocked (CSP or ad-blocker?)' };
}
