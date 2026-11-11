/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ShortcutEditView from './ShortcutEditView.svelte';
import { shortcutStore } from './shortcutStore.svelte';
import { shortcutViewState } from './shortcutViewState.svelte';
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
});
