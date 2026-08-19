import type { Page } from 'playwright';

export interface PerfMetrics {
  lcp?: number;
  cls?: number;
  fcp?: number;
  ttfb?: number;
  domContentLoaded?: number;
  load?: number;
  resourceCount: number;
  totalTransferSize: number;
}

/**
 * Extract Core Web Vitals and performance metrics from the page.
 * Must be called after page.goto() with networkidle.
 *
 * LCP and CLS are observer-only entry types: `getEntriesByType('largest-contentful-paint'
 * | 'layout-shift')` returns [] in Chromium. We register a buffered PerformanceObserver to
 * recover entries that fired before observe(), then let it settle briefly to catch late ones.
 */
export async function extractPerf(
  page: Page,
  opts: { settleMs?: number } = {},
): Promise<PerfMetrics> {
  const settleMs = opts.settleMs ?? 500;
  return await page.evaluate((settle) => {
    const perf = performance;
    const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = perf.getEntriesByType('paint');
    const resources = perf.getEntriesByType('resource') as PerformanceResourceTiming[];

    // FCP
    const fcpEntry = paints.find((e) => e.name === 'first-contentful-paint');
    const fcp = fcpEntry ? Math.round(fcpEntry.startTime) : undefined;

    // TTFB
    const ttfb = nav ? Math.round(nav.responseStart - nav.requestStart) : undefined;

    // DOM Content Loaded
    const domContentLoaded = nav ? Math.round(nav.domContentLoadedEventEnd) : undefined;

    // Load
    const load = nav ? Math.round(nav.loadEventEnd) : undefined;

    // Resources
    const totalTransferSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);

    const base = {
      fcp,
      ttfb,
      domContentLoaded,
      load,
      resourceCount: resources.length,
      totalTransferSize,
    };

    // LCP + CLS via buffered observers; settle, then drain, disconnect, and resolve.
    return new Promise<PerfMetrics>((resolve) => {
      try {
        let clsValue = 0;
        const clsObs = new PerformanceObserver((list) => {
          for (const e of list.getEntries() as any[]) {
            if (!e.hadRecentInput) clsValue += e.value;
          }
        });
        clsObs.observe({ type: 'layout-shift', buffered: true });

        let lcpValue = 0;
        const lcpObs = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1] as any;
          if (last) lcpValue = last.startTime;
        });
        lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });

        setTimeout(() => {
          // Drain records not yet delivered to the callbacks before disconnecting.
          for (const e of clsObs.takeRecords() as any[]) {
            if (!e.hadRecentInput) clsValue += e.value;
          }
          const pending = lcpObs.takeRecords();
          if (pending.length) lcpValue = (pending[pending.length - 1] as any).startTime;
          clsObs.disconnect();
          lcpObs.disconnect();
          resolve({
            ...base,
            lcp: lcpValue ? Math.round(lcpValue) : undefined,
            cls: parseFloat(clsValue.toFixed(4)),
          });
        }, settle);
      } catch {
        resolve({ ...base, lcp: undefined, cls: undefined });
      }
    });
  }, settleMs);
}

export function formatPerf(metrics: PerfMetrics, opts: { compact?: boolean } = {}): string {
  const lines: string[] = [];
  const compact = opts.compact ?? false;

  if (compact) {
    // One-line summary: only metrics with issues or key values
    const parts: string[] = [];
    if (metrics.fcp !== undefined) {
      const rating = metrics.fcp <= 1800 ? '' : metrics.fcp <= 3000 ? ' ⚠' : ' ✗';
      parts.push(`FCP=${metrics.fcp}ms${rating}`);
    }
    if (metrics.lcp !== undefined) {
      const rating = metrics.lcp <= 2500 ? '' : metrics.lcp <= 4000 ? ' ⚠' : ' ✗';
      parts.push(`LCP=${metrics.lcp}ms${rating}`);
    }
    if (metrics.cls !== undefined) {
      const rating = metrics.cls <= 0.1 ? '' : metrics.cls <= 0.25 ? ' ⚠' : ' ✗';
      parts.push(`CLS=${metrics.cls}${rating}`);
    }
    if (metrics.ttfb !== undefined) {
      const rating = metrics.ttfb <= 800 ? '' : metrics.ttfb <= 1800 ? ' ⚠' : ' ✗';
      parts.push(`TTFB=${metrics.ttfb}ms${rating}`);
    }
    parts.push(`${metrics.resourceCount} resources, ${(metrics.totalTransferSize / 1024).toFixed(0)}KB`);
    lines.push(`## Perf: ${parts.join(' | ')}`);
    lines.push('');
  } else {
    lines.push('## Performance Metrics');
    lines.push('');
    lines.push('| Metric | Value | Rating |');
    lines.push('|--------|-------|--------|');

    if (metrics.fcp !== undefined) {
      const rating = metrics.fcp <= 1800 ? 'Good' : metrics.fcp <= 3000 ? 'Needs Work' : 'Poor';
      lines.push(`| FCP (First Contentful Paint) | ${metrics.fcp}ms | ${rating} |`);
    }
    if (metrics.lcp !== undefined) {
      const rating = metrics.lcp <= 2500 ? 'Good' : metrics.lcp <= 4000 ? 'Needs Work' : 'Poor';
      lines.push(`| LCP (Largest Contentful Paint) | ${metrics.lcp}ms | ${rating} |`);
    }
    if (metrics.cls !== undefined) {
      const rating = metrics.cls <= 0.1 ? 'Good' : metrics.cls <= 0.25 ? 'Needs Work' : 'Poor';
      lines.push(`| CLS (Cumulative Layout Shift) | ${metrics.cls} | ${rating} |`);
    }
    if (metrics.ttfb !== undefined) {
      const rating = metrics.ttfb <= 800 ? 'Good' : metrics.ttfb <= 1800 ? 'Needs Work' : 'Poor';
      lines.push(`| TTFB (Time to First Byte) | ${metrics.ttfb}ms | ${rating} |`);
    }
    if (metrics.domContentLoaded !== undefined) {
      lines.push(`| DOM Content Loaded | ${metrics.domContentLoaded}ms | — |`);
    }
    if (metrics.load !== undefined) {
      lines.push(`| Page Load | ${metrics.load}ms | — |`);
    }
    lines.push(`| Resources | ${metrics.resourceCount} requests | — |`);
    lines.push(`| Transfer Size | ${(metrics.totalTransferSize / 1024).toFixed(1)} KB | — |`);
    lines.push('');
  }

  return lines.join('\n');
}
