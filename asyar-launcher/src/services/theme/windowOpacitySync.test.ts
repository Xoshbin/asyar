import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listeners, setWindowGlass, emit } = vi.hoisted(() => ({
  listeners: [] as Array<(s: unknown) => void>,
  setWindowGlass: vi.fn().mockResolvedValue(undefined),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    subscribe: (cb: (s: unknown) => void) => {
      listeners.push(cb);
      return () => {};
    },
  },
}));
vi.mock('../../lib/ipc/windowCommands', () => ({ setWindowGlass }));
vi.mock('@tauri-apps/api/event', () => ({ emit }));
vi.mock('../../lib/keyboard/hostPlatform', () => ({ getHostPlatform: () => 'macos' }));

import { initWindowOpacitySync } from './windowOpacitySync.svelte';

const push = (windowOpacity?: number) => listeners.at(-1)!({ appearance: { windowOpacity } });

describe('initWindowOpacitySync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('switches the native blur only when crossing solid, and broadcasts every change', () => {
    initWindowOpacitySync();
    push();
    expect(setWindowGlass).toHaveBeenLastCalledWith(true);

    push(50);
    push(100);
    push(100);
    push(95);

    expect(setWindowGlass.mock.calls).toEqual([[true], [false], [true]]);
    expect(emit.mock.calls.map(([, p]) => p.opacity)).toEqual([65, 50, 100, 95]);
  });
});
