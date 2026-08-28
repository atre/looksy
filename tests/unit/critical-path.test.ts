import { describe, it, expect } from 'vitest';
import { formatCriticalPath, type CriticalPathData } from '../../src/critical-path.js';

const sampleData: CriticalPathData = {
  renderBlockingResources: [
    { name: 'style.css', url: '', type: 'link', transferSize: 15000, duration: 200, renderBlocking: true },
    { name: 'font.woff2', url: '', type: 'link', transferSize: 30000, duration: 150, renderBlocking: true },
  ],
  renderBlockingSize: 45000,
  renderBlockingTime: 200,
  lcpElement: { element: 'img', url: 'hero.jpg', startTime: 1500, size: 50000 },
  timeToFirstByte: 180,
  dnsTime: 10,
  tcpTime: 20,
  tlsTime: 15,
  serverTime: 120,
  firstPaint: 500,
  fcp: 800,
  domInteractive: 1200,
  deferCandidates: [],
};

describe('formatCriticalPath', () => {
  it('compact mode shows key metrics', () => {
    const result = formatCriticalPath(sampleData, { compact: true });
    expect(result).toContain('TTFB=180ms');
    expect(result).toContain('FCP=800ms');
    expect(result).toContain('2 blocking');
    expect(result).toContain('LCP=img');
  });

  it('verbose mode shows full breakdown', () => {
    const result = formatCriticalPath(sampleData);
    expect(result).toContain('Critical Rendering Path');
    expect(result).toContain('Connection Timing');
    expect(result).toContain('DNS Lookup');
    expect(result).toContain('Paint Timeline');
    expect(result).toContain('LCP Element');
    expect(result).toContain('Render-Blocking Resources');
    expect(result).toContain('style.css');
  });

  it('shows no blocking when empty', () => {
    const noBlocking: CriticalPathData = { ...sampleData, renderBlockingResources: [], renderBlockingSize: 0, renderBlockingTime: 0 };
    const result = formatCriticalPath(noBlocking);
    expect(result).toContain('None detected');
  });
});
