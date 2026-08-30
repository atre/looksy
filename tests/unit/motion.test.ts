import { describe, it, expect } from 'vitest';
import { classifyProperties, buildMotionAudit, type MotionEntry } from '../../src/motion.js';

const entry = (over: Partial<MotionEntry>): MotionEntry => ({
  selector: 'div.card',
  kind: 'transition',
  name: 'width',
  durationMs: 300,
  iterations: 1,
  properties: ['width'],
  ...over,
});

describe('classifyProperties', () => {
  it('marks transform/opacity/filter as compositor-safe', () => {
    const r = classifyProperties(['transform', 'opacity', 'filter']);
    expect(r.layout).toEqual([]);
    expect(r.compositor).toEqual(['transform', 'opacity', 'filter']);
  });
  it('marks width/left/margin-top/padding-inline/inset as layout risk', () => {
    const r = classifyProperties(['width', 'left', 'margin-top', 'padding-inline', 'inset']);
    expect(r.compositor).toEqual([]);
    expect(r.layout).toEqual(['width', 'left', 'margin-top', 'padding-inline', 'inset']);
  });
  it('splits mixed lists', () => {
    const r = classifyProperties(['transform', 'height']);
    expect(r.compositor).toEqual(['transform']);
    expect(r.layout).toEqual(['height']);
  });
});

describe('buildMotionAudit', () => {
  it('flags layout-risk, infinite and long entries', () => {
    const entries = [
      entry({}), // layout risk (width)
      entry({ properties: ['opacity'], name: 'opacity' }), // clean
      entry({ kind: 'animation', name: 'pulse', iterations: 'infinite' }),
      entry({ kind: 'animation', name: 'reveal', durationMs: 1400, properties: ['opacity'] }),
    ];
    const audit = buildMotionAudit(entries, true);
    expect(audit.entries).toHaveLength(4);
    expect(audit.layoutRisk).toHaveLength(1);
    expect(audit.infinite).toHaveLength(1);
    expect(audit.long).toHaveLength(1);
    expect(audit.reducedMotionRespected).toBe(true);
  });
  it('passes reducedMotionRespected=null through (probe skipped)', () => {
    expect(buildMotionAudit([], null).reducedMotionRespected).toBeNull();
  });
});
