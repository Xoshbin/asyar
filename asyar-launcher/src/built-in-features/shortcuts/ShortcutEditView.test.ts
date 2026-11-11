/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ShortcutEditView from './ShortcutEditView.svelte';
import { shortcutStore } from './shortcutStore.svelte';
import { shortcutViewState } from './shortcutViewState.svelte';
import { shortcutService } from './shortcutService';
import { VALID_KEYS } from './shortcutFormatter';
import { viewManager } from '../../services/extension/viewManager.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe('ShortcutEditView', () => {
  beforeEach(() => {
    viewManager.activeView = 'shortcuts/ShortcutEditView';
    shortcutStore.shortcuts = [];
    shortcutViewState.reset();
  });

  afterEach(() => {
    shortcutViewState.clearEdit();
    vi.restoreAllMocks();
  });

  it('renders target shortcut name and activates capturing gate', () => {
    const sc = {
      id: 'sc-1',
      objectId: 'app-terminal',
      itemName: 'Terminal',
      itemType: 'application' as const,
      shortcut: 'Cmd+T',
      itemPath: '/Applications/Utilities/Terminal.app',
      createdAt: Date.now(),
    };
    shortcutViewState.startEdit(sc);

    const { unmount } = render(ShortcutEditView);

    expect(screen.getByText(/Terminal/)).toBeTruthy();
    expect(shortcutStore.isCapturing).toBe(true);

    unmount();
    expect(shortcutStore.isCapturing).toBe(false);
  });

  it('calls viewManager.goBack exactly once on Escape even after unmount', async () => {
    shortcutViewState.startEdit({
      id: 'sc-1',
      objectId: 'app-terminal',
      itemName: 'Terminal',
      itemType: 'application',
      shortcut: 'Cmd+T',
      createdAt: Date.now(),
    });
    const goBackSpy = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});

    const { unmount } = render(ShortcutEditView);
    await fireEvent.keyDown(window, { key: 'Escape', bubbles: true, cancelable: true });
    unmount();

    expect(goBackSpy).toHaveBeenCalledTimes(1);
    expect(shortcutViewState.editingShortcut).toBeNull();
  });

  it('does not call viewManager.goBack when unmounted externally without Escape', () => {
    shortcutViewState.startEdit({
      id: 'sc-1',
      objectId: 'app-terminal',
      itemName: 'Terminal',
      itemType: 'application',
      shortcut: 'Cmd+T',
      createdAt: Date.now(),
    });
    const goBackSpy = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});

    const { unmount } = render(ShortcutEditView);
    unmount();

    expect(goBackSpy).not.toHaveBeenCalled();
  });
  it('does not complete after unmount during a pending save', async () => {
    vi.useFakeTimers();
    try {
      VALID_KEYS.add('T');
      shortcutViewState.startEdit({
        id: 's',
        objectId: 'app',
        itemName: 'App',
        itemType: 'application',
        shortcut: 'Super+T',
        createdAt: 1,
      });
      vi.spyOn(shortcutService, 'isConflict').mockResolvedValue(null);
      let resolve!: (value: { ok: true }) => void;
      const register = vi
        .spyOn(shortcutService, 'register')
        .mockReturnValue(new Promise((r) => (resolve = r)));
      const goBack = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});
      const { unmount } = render(ShortcutEditView);
      await fireEvent.keyDown(window, { key: 't', code: 'KeyT', metaKey: true });
      expect(register).toHaveBeenCalled();
      unmount();
      resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(2000);
      expect(goBack).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
