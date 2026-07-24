import { describe, it, expect } from 'vitest';
import { toFullActionId } from './actionId';

describe('toFullActionId', () => {
  it('prefixes a short action id', () => {
    expect(toFullActionId('org.x', 'run')).toBe('act_org.x_run');
  });

  it('is idempotent for an already-prefixed id (no double-prefix)', () => {
    expect(toFullActionId('org.x', 'act_org.x_run')).toBe('act_org.x_run');
  });

  it('only strips its own extension prefix', () => {
    // Starts with "act_" but for a different extension → still prefixed.
    expect(toFullActionId('org.x', 'act_org.y_run')).toBe('act_org.x_act_org.y_run');
  });
});
