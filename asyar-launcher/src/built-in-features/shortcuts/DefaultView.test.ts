/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DefaultView from './DefaultView.svelte';
import { shortcutStore } from './shortcutStore.svelte';
import { shortcutViewState } from './shortcutViewState.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe('Shortcuts DefaultView', () => {
  beforeEach(() => {
    shortcutStore.shortcuts = [];
    shortcutViewState.reset();
  });

  it('renders metadata list for selected shortcut', () => {
    shortcutStore.shortcuts = [
      {
        id: 'sc-1',
        objectId: 'app-terminal',
        itemName: 'Terminal',
        itemType: 'application',
        shortcut: 'Cmd+T',
        itemPath: '/Applications/Utilities/Terminal.app',
        createdAt: Date.now(),
      },
    ];

    render(DefaultView);

    expect(screen.getByText('Information')).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('application')).toBeTruthy();
    expect(screen.getByText('Path')).toBeTruthy();
    expect(screen.getByText('/Applications/Utilities/Terminal.app')).toBeTruthy();
  });

  it('pushes shortcuts/ShortcutEditView with searchable: false on shortcuts:change action', async () => {
    const sc = {
      id: 'sc-1',
      objectId: 'app-terminal',
      itemName: 'Terminal',
      itemType: 'application' as const,
      shortcut: 'Cmd+T',
      itemPath: '/Applications/Utilities/Terminal.app',
      createdAt: Date.now(),
    };
    shortcutStore.shortcuts = [sc];
    const navSpy = vi.spyOn(viewManager, 'navigateToView').mockImplementation(() => {});

    render(DefaultView);

    const changeAction = actionService.getAllActions().find((a) => a.id === 'shortcuts:change');
    await changeAction?.execute();

    expect(shortcutViewState.editingShortcut).toEqual(sc);
    expect(navSpy).toHaveBeenCalledWith('shortcuts/ShortcutEditView', { searchable: false });
    navSpy.mockRestore();
  });
});
