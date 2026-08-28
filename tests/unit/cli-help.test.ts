import { describe, it, expect, vi } from 'vitest';
import { printHelp } from '../../dist/cli-help.js';

describe('printHelp', () => {
  it('includes a hint to quote URLs containing ? or &', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    log.mockRestore();
    expect(output).toContain('Quote URLs containing ? or &');
  });
});
