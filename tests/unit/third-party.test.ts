import { describe, it, expect } from 'vitest';
import { formatThirdParty, type ThirdPartyData } from '../../src/third-party.js';

const sampleData: ThirdPartyData = {
  entries: [
    { origin: 'https://fonts.googleapis.com', category: 'fonts', requestCount: 3, totalTransferSize: 30000, totalDuration: 200, renderBlocking: 1, scripts: [] },
    { origin: 'https://js.stripe.com', category: 'payment', requestCount: 2, totalTransferSize: 80000, totalDuration: 500, renderBlocking: 0, scripts: [{ name: 'v3.js', async: true, defer: false, transferSize: 80000 }] },
    { origin: 'https://plausible.io', category: 'analytics', requestCount: 1, totalTransferSize: 1500, totalDuration: 100, renderBlocking: 0, scripts: [{ name: 'script.js', async: true, defer: true, transferSize: 1500 }] },
  ],
  firstPartyOrigin: 'https://example.com',
  thirdPartyCount: 3,
  thirdPartySize: 111500,
  renderBlockingCount: 1,
};

describe('formatThirdParty', () => {
  it('shows empty message when no third parties', () => {
    const result = formatThirdParty({ entries: [], firstPartyOrigin: 'https://example.com', thirdPartyCount: 0, thirdPartySize: 0, renderBlockingCount: 0 });
    expect(result).toContain('No third-party');
  });

  it('compact mode shows origin count', () => {
    const result = formatThirdParty(sampleData, { compact: true });
    expect(result).toContain('3 origins');
    expect(result).toContain('render-blocking');
  });

  it('verbose mode shows origins and scripts', () => {
    const result = formatThirdParty(sampleData);
    expect(result).toContain('Third-Party');
    expect(result).toContain('fonts');
    expect(result).toContain('payment');
    expect(result).toContain('analytics');
    expect(result).toContain('Script Loading');
    expect(result).toContain('async');
  });
});
