/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  shortcutUpsert: vi.fn().mockResolvedValue(undefined),
  shortcutGetAll: vi.fn(async () => []),
  shortcutRemove: vi.fn().mockResolvedValue(undefined),
}));

const bridge = vi.hoisted(() => {
  const live = new Set<() => void>();
  const appListen = vi.fn(async (_event: string, cb: () => void) => {
    live.add(cb);
    return () => {
      live.delete(cb);
    };
  });
  return { live, appListen };
});
vi.mock('../../lib/ipc/bridgeEvents', () => ({ appListen: bridge.appListen }));

import { shortcutStore } from './shortcutStore.svelte';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('shortcutStore — shortcuts:changed listener lifecycle', () => {
  it('keeps exactly one live listener however many times it reloads', async () => {
    await shortcutStore.init();
    expect(bridge.live.size).toBe(1);

    // Cloud sync upserts N shortcuts; Rust emits `shortcuts:changed` for each,
    // and every delivery triggers `reload()`. Each reload used to register a
    // fresh listener without dropping the previous one, so the listener count
    // doubled per event (exponential reload storm that froze the app).
    for (let i = 0; i < 6; i++) {
      for (const cb of [...bridge.live]) cb();
      await settle();
    }

    expect(bridge.live.size).toBe(1);
  });
});
