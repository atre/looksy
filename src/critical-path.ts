import type { Page } from 'playwright';
import { formatBytes } from './utils.js';

export interface CriticalResource {
  name: string;
  url: string;
  type: string;
  transferSize: number;
  duration: number;
  renderBlocking: boolean;
}

export interface LcpInfo {
  element: string;
  url?: string;
  startTime: number;
  size: number;
}

export interface CriticalPathData {
  renderBlockingResources: CriticalResource[];
  renderBlockingSize: number;
  renderBlockingTime: number;
  lcpElement?: LcpInfo;
  timeToFirstByte: number;
  dnsTime: number;
  tcpTime: number;
  tlsTime: number;
  serverTime: number;
  firstPaint?: number;
  fcp?: number;
  domInteractive?: number;
  deferCandidates: CriticalResource[];
}

/** Extract critical rendering path data. */
export async function extractCriticalPath(page: Page): Promise<CriticalPathData> {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const paints = performance.getEntriesByType('paint');

    // Navigation timing breakdown
    const dnsTime = nav ? Math.round(nav.domainLookupEnd - nav.domainLookupStart) : 0;
    const tcpTime = nav ? Math.round(nav.connectEnd - nav.connectStart) : 0;
    const tlsTime = nav ? Math.round((nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0)) : 0;
    const serverTime = nav ? Math.round(nav.responseStart - nav.requestStart) : 0;
    const timeToFirstByte = nav ? Math.round(nav.responseStart - nav.fetchStart) : 0;

    // First paint times
    const fpEntry = paints.find(e => e.name === 'first-paint');
    const fcpEntry = paints.find(e => e.name === 'first-contentful-paint');
    const firstPaint = fpEntry ? Math.round(fpEntry.startTime) : undefined;
    const fcp = fcpEntry ? Math.round(fcpEntry.startTime) : undefined;
    const domInteractive = nav ? Math.round(nav.domInteractive) : undefined;

    // Render-blocking resources
    const renderBlocking: CriticalResource[] = [];
    const deferCandidates: CriticalResource[] = [];

    for (const r of resources) {
      const name = r.name.split('/').pop()?.split('?')[0] || r.name;
      const isBlocking = (r as any).renderBlockingStatus === 'blocking';
      const entry: CriticalResource = {
        name: name.length > 35 ? name.slice(0, 35) + '...' : name,
        url: r.name,
        type: r.initiatorType,
        transferSize: r.transferSize || 0,
        duration: Math.round(r.duration),
        renderBlocking: isBlocking,
      };

      if (isBlocking) {
        renderBlocking.push(entry);
      }

      // Suggest deferring non-critical CSS/JS in head
      if (!isBlocking && (r.initiatorType === 'script' || r.initiatorType === 'link') &&
          r.startTime < (fcp || 1000) && r.duration > 100) {
        deferCandidates.push(entry);
      }
    }

    renderBlocking.sort((a, b) => b.duration - a.duration);

    const renderBlockingSize = renderBlocking.reduce((s, r) => s + r.transferSize, 0);
    const renderBlockingTime = renderBlocking.length > 0 ? Math.max(...renderBlocking.map(r => r.duration)) : 0;

    // LCP element
    let lcpElement: LcpInfo | undefined;
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint') as any[];
    if (lcpEntries.length > 0) {
      const last = lcpEntries[lcpEntries.length - 1];
      lcpElement = {
        element: last.element?.tagName?.toLowerCase() || 'unknown',
        url: last.url || undefined,
        startTime: Math.round(last.startTime),
        size: last.size || 0,
      };
    }

    return {
      renderBlockingResources: renderBlocking,
      renderBlockingSize,
      renderBlockingTime,
      lcpElement,
      timeToFirstByte,
      dnsTime,
      tcpTime,
      tlsTime,
      serverTime,
      firstPaint,
      fcp,
      domInteractive,
      deferCandidates,
    };
  });
}

export function formatCriticalPath(data: CriticalPathData, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    const parts: string[] = [];
    parts.push(`TTFB=${data.timeToFirstByte}ms`);
    if (data.fcp) parts.push(`FCP=${data.fcp}ms`);
    parts.push(`${data.renderBlockingResources.length} blocking (${formatBytes(data.renderBlockingSize)})`);
    if (data.lcpElement) parts.push(`LCP=${data.lcpElement.element} @${data.lcpElement.startTime}ms`);
    return `## Critical Path: ${parts.join(' | ')}\n`;
  }

  const lines = ['## Critical Rendering Path\n'];

  // TTFB breakdown
  lines.push('### Connection Timing\n');
  lines.push(`| Phase | Duration |`);
  lines.push(`|-------|----------|`);
  lines.push(`| DNS Lookup | ${data.dnsTime}ms |`);
  lines.push(`| TCP Connect | ${data.tcpTime}ms |`);
  if (data.tlsTime > 0) lines.push(`| TLS Handshake | ${data.tlsTime}ms |`);
  lines.push(`| Server Processing | ${data.serverTime}ms |`);
  lines.push(`| **Time to First Byte** | **${data.timeToFirstByte}ms** |`);
  lines.push('');

  // Paint milestones
  lines.push('### Paint Timeline\n');
  if (data.firstPaint) lines.push(`- **First Paint:** ${data.firstPaint}ms`);
  if (data.fcp) lines.push(`- **First Contentful Paint:** ${data.fcp}ms`);
  if (data.domInteractive) lines.push(`- **DOM Interactive:** ${data.domInteractive}ms`);
  lines.push('');

  // LCP
  if (data.lcpElement) {
    lines.push('### LCP Element\n');
    lines.push(`- **Element:** \`<${data.lcpElement.element}>\``);
    lines.push(`- **Time:** ${data.lcpElement.startTime}ms`);
    if (data.lcpElement.url) lines.push(`- **Resource:** ${data.lcpElement.url.split('/').pop()?.split('?')[0]}`);
    lines.push('');
  }

  // Render-blocking resources
  if (data.renderBlockingResources.length > 0) {
    lines.push('### Render-Blocking Resources\n');
    lines.push(`**${data.renderBlockingResources.length} resources** blocking render (${formatBytes(data.renderBlockingSize)}, ${data.renderBlockingTime}ms)\n`);
    lines.push('| Resource | Type | Size | Duration |');
    lines.push('|----------|------|------|----------|');
    for (const r of data.renderBlockingResources) {
      lines.push(`| ${r.name} | ${r.type} | ${formatBytes(r.transferSize)} | ${r.duration}ms |`);
    }
    lines.push('');
  } else {
    lines.push('### Render-Blocking: None detected ✓\n');
  }

  // Defer candidates
  if (data.deferCandidates.length > 0) {
    lines.push('### Defer Candidates\n');
    lines.push('Resources loading before FCP that could be deferred:\n');
    for (const r of data.deferCandidates) {
      lines.push(`- ${r.name} (${r.type}, ${formatBytes(r.transferSize)}, ${r.duration}ms)`);
    }
    lines.push('');
  }

  lines.push('');
  return lines.join('\n');
}
