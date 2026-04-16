import { describe, it, expect } from 'vitest';
import { defineServiceRegistry } from './defineServiceRegistry';

describe('defineServiceRegistry', () => {
  it('returns the same object passed in (identity preserved)', () => {
    const a = {};
    const b = {};
    const r = defineServiceRegistry({ clipboard: a, fs: b });
    expect(r.clipboard).toBe(a);
    expect(r.fs).toBe(b);
  });

  it('preserves all entries', () => {
    const r = defineServiceRegistry({
      clipboard: {},
      fs: {},
      ai: {},
      window: {},
    });
    expect(Object.keys(r).sort()).toEqual(['ai', 'clipboard', 'fs', 'window']);
  });
});
