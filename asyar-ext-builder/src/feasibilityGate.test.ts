import { describe, it, expect } from 'bun:test';
import { buildGatePrompt, parseVerdict } from './feasibilityGate';

describe('buildGatePrompt', () => {
  it('embeds the user request and the capability list', () => {
    const p = buildGatePrompt('build a keylogger', { permissions: ['network'], cannot: ['No native/OS access'] } as any);
    expect(p).toContain('build a keylogger');
    expect(p).toContain('network');
    expect(p).toContain('No native/OS access');
  });
});

describe('parseVerdict', () => {
  it('parses a possible verdict', () => {
    expect(parseVerdict('{"possible":true,"reason":"fits storage + network"}')).toEqual({ possible: true, reason: 'fits storage + network' });
  });
  it('parses an impossible verdict with reason', () => {
    expect(parseVerdict('garbage {"possible":false,"reason":"needs a keylogger"} trailing')).toEqual({ possible: false, reason: 'needs a keylogger' });
  });
  it('defaults to impossible when unparseable (fail safe)', () => {
    const v = parseVerdict('no json here');
    expect(v.possible).toBe(false);
  });
});
