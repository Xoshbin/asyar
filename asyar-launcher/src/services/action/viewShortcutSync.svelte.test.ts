// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const state = vi.hoisted(() => ({
  viewManager: { activeView: null as string | null },
  actionService: { filteredActions: [] as unknown[] },
  chords: [] as string[],
  builtIn: false,
  send: vi.fn(),
}));

vi.mock('../extension/viewManager.svelte', () => ({ viewManager: state.viewManager }));
vi.mock('./actionService.svelte', () => ({ actionService: state.actionService }));
vi.mock('./actionShortcuts', () => ({
  actionShortcuts: { activeChords: () => state.chords },
}));
vi.mock('../extension/extensionDiscovery', () => ({
  isBuiltInFeature: () => state.builtIn,
}));
vi.mock('../extension/extensionIframeManager.svelte', () => ({
  extensionIframeManager: { sendActionShortcuts: state.send },
}));

import { announceActiveViewShortcuts, startViewShortcutSync } from './viewShortcutSync.svelte';

describe('announceActiveViewShortcuts', () => {
  beforeEach(() => {
    state.viewManager.activeView = null;
    state.chords = [];
    state.builtIn = false;
    state.send.mockReset();
  });

  it('sends the live chords to the active Tier 2 view', () => {
    state.viewManager.activeView = 'org.acme.ext/DefaultView';
    state.chords = ['Super+N'];
    announceActiveViewShortcuts({ force: true });
    expect(state.send).toHaveBeenCalledWith('org.acme.ext', ['Super+N']);
  });

  it('does nothing without an active view', () => {
    announceActiveViewShortcuts({ force: true });
    expect(state.send).not.toHaveBeenCalled();
  });

  it('does nothing for built-in views, which receive keys directly', () => {
    state.viewManager.activeView = 'notes/DefaultView';
    state.builtIn = true;
    state.chords = ['Super+N'];
    announceActiveViewShortcuts({ force: true });
    expect(state.send).not.toHaveBeenCalled();
  });

  it('skips an unchanged set but resends when forced (a fresh iframe load)', () => {
    state.viewManager.activeView = 'org.acme.ext/DefaultView';
    state.chords = ['Super+N'];
    announceActiveViewShortcuts({ force: true });
    announceActiveViewShortcuts();
    expect(state.send).toHaveBeenCalledTimes(1);
    announceActiveViewShortcuts({ force: true });
    expect(state.send).toHaveBeenCalledTimes(2);
  });

  it('sends again when the set changes', () => {
    state.viewManager.activeView = 'org.acme.ext/DefaultView';
    state.chords = ['Super+N'];
    announceActiveViewShortcuts({ force: true });
    state.chords = ['Super+N', 'Super+M'];
    announceActiveViewShortcuts();
    // Sent sorted, so the signature does not depend on candidate order.
    expect(state.send).toHaveBeenLastCalledWith('org.acme.ext', ['Super+M', 'Super+N']);
  });
});

describe('startViewShortcutSync', () => {
  it('announces on start and stops when disposed', async () => {
    state.viewManager.activeView = 'org.acme.ext/DefaultView';
    state.chords = ['Super+A'];
    state.send.mockReset();
    const stop = startViewShortcutSync();
    flushSync();
    await Promise.resolve();
    expect(state.send).toHaveBeenCalledWith('org.acme.ext', ['Super+A']);
    stop();
  });
});
