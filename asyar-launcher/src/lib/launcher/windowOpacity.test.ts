import { describe, it, expect } from 'vitest';
import { defaultWindowOpacity, resolveWindowOpacity } from './windowOpacity';

describe('resolveWindowOpacity', () => {
  it('keeps each platform on its current look by default', () => {
    expect(resolveWindowOpacity({}, 'macos')).toBe(65);
    expect(resolveWindowOpacity({}, 'windows')).toBe(85);
  });

  it('snaps and clamps the stored value', () => {
    expect(resolveWindowOpacity({ windowOpacity: 72 }, 'macos')).toBe(70);
    expect(resolveWindowOpacity({ windowOpacity: -10 }, 'macos')).toBe(0);
    expect(resolveWindowOpacity({ windowOpacity: 140 }, 'macos')).toBe(100);
  });

  it('lets an active custom theme win', () => {
    expect(resolveWindowOpacity({ windowOpacity: 100, activeTheme: 'nord' }, 'macos')).toBe(
      defaultWindowOpacity('macos'),
    );
  });
});
