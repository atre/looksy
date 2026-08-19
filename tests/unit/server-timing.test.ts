import { describe, it, expect } from 'vitest';
import { formatServerTiming, type ServerTimingData } from '../../src/server-timing.js';

const sampleData: ServerTimingData = {
  entries: [
    { name: 'db', duration: 50, description: 'Database query' },
    { name: 'render', duration: 30, description: 'SSR render' },
  ],
  ttfb: 250,
  dnsTime: 10,
  tcpTime: 20,
  tlsTime: 15,
  serverProcessing: 180,
  ttfbRating: 'Needs Work',
  redirectTime: 0,
};

describe('formatServerTiming', () => {
  it('compact mode shows TTFB rating', () => {
    const result = formatServerTiming(sampleData, { compact: true });
    expect(result).toContain('TTFB=250ms');
    expect(result).toContain('⚠');
    expect(result).toContain('server=180ms');
    expect(result).toContain('2 Server-Timing');
  });

  it('verbose mode shows breakdown and entries', () => {
    const result = formatServerTiming(sampleData);
    expect(result).toContain('Server Timing');
    expect(result).toContain('TTFB Breakdown');
    expect(result).toContain('DNS Lookup');
    expect(result).toContain('Needs Work');
    expect(result).toContain('Server-Timing Header');
    expect(result).toContain('Database query');
    expect(result).toContain('SSR render');
  });

  it('good TTFB has no warning symbol in compact', () => {
    const good: ServerTimingData = { ...sampleData, ttfb: 100, ttfbRating: 'Good' };
    const result = formatServerTiming(good, { compact: true });
    expect(result).toContain('TTFB=100ms');
    expect(result).not.toContain('⚠');
    expect(result).not.toContain('✗');
  });

  it('poor TTFB shows failure symbol', () => {
    const poor: ServerTimingData = { ...sampleData, ttfb: 800, ttfbRating: 'Poor' };
    const result = formatServerTiming(poor, { compact: true });
    expect(result).toContain('✗');
  });
});
