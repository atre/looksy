import type { Page } from 'playwright';

export interface ServerTimingEntry {
  name: string;
  duration?: number;
  description?: string;
}

export interface ServerTimingData {
  entries: ServerTimingEntry[];
  ttfb: number;
  dnsTime: number;
  tcpTime: number;
  tlsTime: number;
  serverProcessing: number;
  ttfbRating: 'Good' | 'Needs Work' | 'Poor';
  redirectTime: number;
}

/** Extract server timing and TTFB breakdown. */
export async function extractServerTiming(page: Page): Promise<ServerTimingData> {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    // Parse Server-Timing header if present
    const entries: ServerTimingEntry[] = [];
    if (nav && (nav as any).serverTiming) {
      for (const st of (nav as any).serverTiming) {
        entries.push({
          name: st.name,
          duration: st.duration > 0 ? Math.round(st.duration) : undefined,
          description: st.description || undefined,
        });
      }
    }

    const dnsTime = nav ? Math.round(nav.domainLookupEnd - nav.domainLookupStart) : 0;
    const tcpTime = nav ? Math.round(nav.connectEnd - nav.connectStart) : 0;
    const tlsTime = nav ? Math.round(nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0) : 0;
    const serverProcessing = nav ? Math.round(nav.responseStart - nav.requestStart) : 0;
    const ttfb = nav ? Math.round(nav.responseStart - nav.fetchStart) : 0;
    const redirectTime = nav ? Math.round(nav.redirectEnd - nav.redirectStart) : 0;

    let ttfbRating: 'Good' | 'Needs Work' | 'Poor' = 'Good';
    if (ttfb > 600) ttfbRating = 'Poor';
    else if (ttfb > 200) ttfbRating = 'Needs Work';

    return { entries, ttfb, dnsTime, tcpTime, tlsTime, serverProcessing, ttfbRating, redirectTime };
  });
}

export function formatServerTiming(data: ServerTimingData, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    const rating = data.ttfbRating === 'Good' ? '' : data.ttfbRating === 'Needs Work' ? ' ⚠' : ' ✗';
    const parts = [
      `TTFB=${data.ttfb}ms${rating}`,
      `DNS=${data.dnsTime}ms`,
      `TCP=${data.tcpTime}ms`,
      `server=${data.serverProcessing}ms`,
    ];
    if (data.entries.length > 0) parts.push(`${data.entries.length} Server-Timing entries`);
    return `## Server Timing: ${parts.join(' | ')}\n`;
  }

  const lines = ['## Server Timing\n'];

  // TTFB breakdown
  const rating = data.ttfbRating;
  lines.push('### TTFB Breakdown\n');
  lines.push('| Phase | Duration | Rating |');
  lines.push('|-------|----------|--------|');
  if (data.redirectTime > 0) {
    lines.push(`| Redirect | ${data.redirectTime}ms | — |`);
  }
  lines.push(`| DNS Lookup | ${data.dnsTime}ms | — |`);
  lines.push(`| TCP Connect | ${data.tcpTime}ms | — |`);
  if (data.tlsTime > 0) {
    lines.push(`| TLS Handshake | ${data.tlsTime}ms | — |`);
  }
  lines.push(`| Server Processing | ${data.serverProcessing}ms | — |`);
  lines.push(`| **Total TTFB** | **${data.ttfb}ms** | **${rating}** |`);
  lines.push('');

  // Server-Timing entries
  if (data.entries.length > 0) {
    lines.push('### Server-Timing Header\n');
    lines.push('| Metric | Duration | Description |');
    lines.push('|--------|----------|-------------|');
    for (const e of data.entries.slice(0, 20)) {
      const dur = e.duration !== undefined ? `${e.duration}ms` : '—';
      lines.push(`| ${e.name} | ${dur} | ${e.description || '—'} |`);
    }
    lines.push('');
  }

  lines.push('');
  return lines.join('\n');
}
