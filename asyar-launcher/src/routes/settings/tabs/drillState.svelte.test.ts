import { describe, it, expect } from 'vitest';
import { DrillState } from './drillState.svelte';

describe('DrillState', () => {
  it('starts on the list', () => {
    const d = new DrillState();
    expect(d.id).toBeNull();
    expect(d.canBack).toBe(false);
    expect(d.canForward).toBe(false);
  });

  it('into → back → forward round-trips including the command', () => {
    const d = new DrillState();
    d.into('built-in-ai', 'cmd1');
    expect(d.canBack).toBe(true);
    d.back();
    expect(d.id).toBeNull();
    expect(d.canForward).toBe(true);
    d.forward();
    expect(d.id).toBe('built-in-ai');
    expect(d.commandId).toBe('cmd1');
    expect(d.canForward).toBe(false);
  });

  it('a new drill clears the forward target', () => {
    const d = new DrillState();
    d.into('a');
    d.back();
    d.into('b');
    d.back();
    d.forward();
    expect(d.id).toBe('b');
  });
});
