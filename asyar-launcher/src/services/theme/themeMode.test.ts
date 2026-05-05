/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./nativeBarSync', () => ({
  syncNativeBarStyle: vi.fn(),
}));

import type { syncNativeBarStyle as SyncFn } from './nativeBarSync';

type ChangeListener = (e: MediaQueryListEvent) => void;

interface FakeMediaQuery {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  emit: (matches: boolean) => void;
}

function installMatchMedia(initialDark: boolean): FakeMediaQuery {
  const listeners = new Set<ChangeListener>();
  const mq: FakeMediaQuery = {
    matches: initialDark,
    addEventListener: vi.fn((_: string, cb: ChangeListener) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: ChangeListener) => listeners.delete(cb)),
    emit(matches: boolean) {
      this.matches = matches;
      for (const cb of listeners) cb({ matches } as MediaQueryListEvent);
    },
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  return mq;
}

async function loadModule() {
  const mod = await import('./themeMode');
  const { syncNativeBarStyle } = await import('./nativeBarSync');
  return { mod, syncNativeBarStyle: vi.mocked(syncNativeBarStyle as typeof SyncFn) };
}

// rAF runs the callback synchronously in tests so we can assert side effects
// without flushing timers.
function stubRaf(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
}

describe('themeMode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    stubRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('forced "dark" sets data-theme="dark"', async () => {
    installMatchMedia(false);
    const { mod } = await loadModule();
    mod.applyThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('forced "light" sets data-theme="light"', async () => {
    installMatchMedia(true);
    const { mod } = await loadModule();
    mod.applyThemePreference('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('"system" resolves to "dark" when OS prefers dark', async () => {
    installMatchMedia(true);
    const { mod } = await loadModule();
    mod.applyThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('"system" resolves to "light" when OS prefers light', async () => {
    installMatchMedia(false);
    const { mod } = await loadModule();
    mod.applyThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('triggers syncNativeBarStyle when data-theme changes', async () => {
    installMatchMedia(false);
    const { mod, syncNativeBarStyle } = await loadModule();
    mod.applyThemePreference('dark');
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(1);
  });

  it('skips syncNativeBarStyle when data-theme is unchanged', async () => {
    installMatchMedia(true);
    const { mod, syncNativeBarStyle } = await loadModule();
    mod.applyThemePreference('system'); // resolves to dark, sets attribute
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(1);
    mod.applyThemePreference('dark'); // already dark — no-op
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(1);
  });

  it('resyncs on OS toggle while preference is "system"', async () => {
    const mq = installMatchMedia(false);
    const { mod, syncNativeBarStyle } = await loadModule();
    mod.applyThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(1);

    mq.emit(true); // OS flipped to dark
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(2);
  });

  it('ignores OS toggle once preference is forced', async () => {
    const mq = installMatchMedia(false);
    const { mod, syncNativeBarStyle } = await loadModule();
    mod.applyThemePreference('system');
    mod.applyThemePreference('dark'); // user forces dark — listener removed
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(2); // light → dark

    mq.emit(false); // OS flipped to light — should not retint
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(syncNativeBarStyle).toHaveBeenCalledTimes(2);
    expect(mq.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('installs the matchMedia listener exactly once across system→system calls', async () => {
    const mq = installMatchMedia(false);
    const { mod } = await loadModule();
    mod.applyThemePreference('system');
    mod.applyThemePreference('system');
    mod.applyThemePreference('system');
    expect(mq.addEventListener).toHaveBeenCalledTimes(1);
  });
});
