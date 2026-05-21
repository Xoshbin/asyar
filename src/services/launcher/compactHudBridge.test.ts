/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AggregateCounts } from './itemStatusLogic';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'macos'),
}));

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function loadModule() {
  const mod = await import('./compactHudBridge');
  const { invoke } = await import('@tauri-apps/api/core');
  return { mod, invoke: vi.mocked(invoke) };
}

function counts(active: number, done: number): AggregateCounts {
  return { active, done };
}

describe('compactHudBridge.pushShowMoreBarHuds (macOS)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invokes update_show_more_bar_huds with the snake_case payload Rust expects', async () => {
    const { mod, invoke } = await loadModule();
    await mod.pushShowMoreBarHuds(counts(3, 1));
    expect(invoke).toHaveBeenCalledWith('update_show_more_bar_huds', {
      huds: { active: 3, done: 1 },
    });
  });

  it('deduplicates back-to-back pushes with identical counts', async () => {
    // The TS layer is the change-detector. Rust would no-op too, but a TS
    // dedup avoids the IPC round-trip on every reactive re-evaluation of
    // aggregateKindCounts (which fires on every runService.active write).
    const { mod, invoke } = await loadModule();
    await mod.pushShowMoreBarHuds(counts(3, 1));
    await mod.pushShowMoreBarHuds(counts(3, 1));
    await mod.pushShowMoreBarHuds(counts(3, 1));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('emits a new invoke when any count field changes', async () => {
    const { mod, invoke } = await loadModule();
    await mod.pushShowMoreBarHuds(counts(3, 1));
    await mod.pushShowMoreBarHuds(counts(3, 2));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('always pushes the first call even when all counts are zero — Rust needs to hide chips at startup', async () => {
    // Otherwise the native bar boots with whatever subview state it was
    // built with and never gets a "zero" signal to hide on a quiet system.
    const { mod, invoke } = await loadModule();
    await mod.pushShowMoreBarHuds(counts(0, 0));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('swallows invoke rejections (logs at debug) — must not break callers', async () => {
    const { mod, invoke } = await loadModule();
    invoke.mockRejectedValueOnce(new Error('boom'));
    await expect(mod.pushShowMoreBarHuds(counts(1, 0))).resolves.toBeUndefined();
  });
});

describe('compactHudBridge.pushShowMoreBarHuds (non-macOS)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('is a no-op when platform() reports a non-macOS value', async () => {
    vi.doMock('@tauri-apps/plugin-os', () => ({
      platform: vi.fn(() => 'windows'),
    }));
    const { mod, invoke } = await loadModule();
    await mod.pushShowMoreBarHuds(counts(3, 1));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('treats a thrown platform() detection as non-macOS (defensive)', async () => {
    vi.doMock('@tauri-apps/plugin-os', () => ({
      platform: vi.fn(() => { throw new Error('no plugin'); }),
    }));
    const { mod, invoke } = await loadModule();
    await mod.pushShowMoreBarHuds(counts(3, 1));
    expect(invoke).not.toHaveBeenCalled();
  });
});
