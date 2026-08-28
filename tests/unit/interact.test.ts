import { describe, it, expect } from 'vitest';
import { parseInteractions } from '../../dist/interact.js';

describe('parseInteractions', () => {
  it('parses click action', () => {
    expect(parseInteractions('click:.btn')).toEqual([
      { type: 'click', target: '.btn' },
    ]);
  });

  it('parses scroll action', () => {
    expect(parseInteractions('scroll:500')).toEqual([
      { type: 'scroll', value: '500' },
    ]);
  });

  it('parses scroll-to action', () => {
    expect(parseInteractions('scroll-to:.footer')).toEqual([
      { type: 'scroll-to', target: '.footer' },
    ]);
  });

  it('parses type action with = separator', () => {
    expect(parseInteractions('type:.search=hello world')).toEqual([
      { type: 'type', target: '.search', value: 'hello world' },
    ]);
  });

  it('parses hover action', () => {
    expect(parseInteractions('hover:.menu')).toEqual([
      { type: 'hover', target: '.menu' },
    ]);
  });

  it('parses wait action', () => {
    expect(parseInteractions('wait:500')).toEqual([
      { type: 'wait', value: '500' },
    ]);
  });

  it('parses chained actions', () => {
    const actions = parseInteractions('click:.btn,wait:500,scroll:800');
    expect(actions).toEqual([
      { type: 'click', target: '.btn' },
      { type: 'wait', value: '500' },
      { type: 'scroll', value: '800' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseInteractions('')).toEqual([]);
  });

  it('skips parts without colon', () => {
    expect(parseInteractions('badaction,click:.btn')).toEqual([
      { type: 'click', target: '.btn' },
    ]);
  });

  it('handles whitespace in chain', () => {
    const actions = parseInteractions('click:.btn , wait:200');
    expect(actions).toEqual([
      { type: 'click', target: '.btn' },
      { type: 'wait', value: '200' },
    ]);
  });
});
