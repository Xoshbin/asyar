/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(),
}));
vi.mock('./DefaultView.svelte', () => ({ default: {} }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({ writeText: vi.fn() }));
vi.mock('../../lib/rankItems', () => ({ rankItems: vi.fn() }));
vi.mock('../../components/base/Modal.logic', () => ({
  isAnyModalOpen: vi.fn(() => false),
}));
vi.mock('./snippetService', () => ({
  snippetService: {
    onViewOpen: vi.fn().mockResolvedValue({ permissionGranted: true }),
    pasteSnippet: vi.fn().mockResolvedValue(true),
    syncToRust: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

import snippetsExtension from './index';
import { snippetStore } from './snippetStore.svelte';
import { snippetViewState } from './snippetViewState.svelte';
import { rankItems } from '../../lib/rankItems';
import { isAnyModalOpen } from '../../components/base/Modal.logic';
import { snippetService } from './snippetService';
import { actionService } from '../../services/action/actionService.svelte';

describe('SnippetsExtension keyboard navigation and search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snippetStore.snippets = [
      {
        id: '1',
        name: 'Work Email',
        keyword: ';email',
        expansion: 'work@example.com',
        createdAt: 1,
      },
      { id: '2', name: 'Home Address', keyword: ';addr', expansion: '123 Main St', createdAt: 2 },
      { id: '3', name: 'Work Slack', keyword: ';slack', expansion: 'slack-work', createdAt: 3 },
    ];
    snippetViewState.reset();
  });

  afterEach(async () => {
    await snippetsExtension.viewDeactivated('snippets/DefaultView');
  });

  it('registers keydown listener in capture phase and unregisters on deactivation', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    await snippetsExtension.viewActivated('snippets/DefaultView');
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    await snippetsExtension.viewDeactivated('snippets/DefaultView');
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('navigates with ArrowDown and ArrowUp before search', async () => {
    await snippetsExtension.viewActivated('snippets/DefaultView');
    expect(snippetViewState.selectedIndex).toBe(0);

    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(downEvent);
    expect(snippetViewState.selectedIndex).toBe(1);
    expect(downEvent.defaultPrevented).toBe(true);

    const upEvent = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(upEvent);
    expect(snippetViewState.selectedIndex).toBe(0);
    expect(upEvent.defaultPrevented).toBe(true);
  });

  it('navigates with ArrowDown and ArrowUp after search', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([
      snippetStore.snippets[0],
      snippetStore.snippets[2],
    ]);

    await snippetsExtension.viewActivated('snippets/DefaultView');
    await snippetsExtension.onViewSearch('work');

    expect(snippetViewState.selectedIndex).toBe(0);
    expect(snippetViewState.selectedSnippet?.name).toBe('Work Email');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(snippetViewState.selectedIndex).toBe(1);
    expect(snippetViewState.selectedSnippet?.name).toBe('Work Slack');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(snippetViewState.selectedIndex).toBe(0);
    expect(snippetViewState.selectedSnippet?.name).toBe('Work Email');
  });

  it('does not reset selectedIndex when onViewSearch is called repeatedly with the same query', async () => {
    vi.mocked(rankItems).mockResolvedValueOnce([
      snippetStore.snippets[0],
      snippetStore.snippets[2],
    ]);

    await snippetsExtension.viewActivated('snippets/DefaultView');
    await snippetsExtension.onViewSearch('work');
    expect(snippetViewState.selectedIndex).toBe(0);

    // Navigate down
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(snippetViewState.selectedIndex).toBe(1);

    // Same search query triggered again by searchController effect
    await snippetsExtension.onViewSearch('work');
    expect(snippetViewState.selectedIndex).toBe(1);
    expect(rankItems).toHaveBeenCalledTimes(1);
  });

  it('calls pasteSnippet on Enter when a snippet is selected', async () => {
    await snippetsExtension.viewActivated('snippets/DefaultView');
    expect(snippetViewState.selectedSnippet?.expansion).toBe('work@example.com');

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    const stopSpy = vi.spyOn(enterEvent, 'stopPropagation');
    window.dispatchEvent(enterEvent);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    expect(snippetService.pasteSnippet).toHaveBeenCalledWith('work@example.com');
  });

  it('ignores keydown when a modal is open', async () => {
    vi.mocked(isAnyModalOpen).mockReturnValue(true);

    await snippetsExtension.viewActivated('snippets/DefaultView');
    expect(snippetViewState.selectedIndex).toBe(0);

    const downEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(downEvent);

    expect(snippetViewState.selectedIndex).toBe(0);
    expect(downEvent.defaultPrevented).toBe(false);
  });

  it('ignores keydown when .action-popup is present in document', async () => {
    const popup = document.createElement('div');
    popup.className = 'action-popup';
    document.body.appendChild(popup);

    try {
      await snippetsExtension.viewActivated('snippets/DefaultView');
      expect(snippetViewState.selectedIndex).toBe(0);

      const downEvent = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(downEvent);

      expect(snippetViewState.selectedIndex).toBe(0);
      expect(downEvent.defaultPrevented).toBe(false);
    } finally {
      document.body.removeChild(popup);
    }
  });
});

describe('SnippetsExtension lifecycle: activate and deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  it('activate() reloads snippetStore', async () => {
    const reloadSpy = vi.spyOn(snippetStore, 'reload').mockResolvedValue(undefined);
    await snippetsExtension.activate();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('viewActivated registers view actions including toggle-private', async () => {
    await snippetsExtension.viewActivated('snippets/DefaultView');
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'snippets:add' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'snippets:paste' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'snippets:delete' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'snippets:toggle-private', icon: 'icon:lock' }),
    );
  });

  it('snippets:toggle-private executes togglePrivate on selectedSnippet and syncs to rust', async () => {
    snippetStore.snippets = [
      {
        id: '1',
        name: 'Work Email',
        keyword: ';email',
        expansion: 'work@example.com',
        createdAt: 1,
        isPrivate: false,
      },
    ];
    snippetViewState.reset();
    await snippetsExtension.viewActivated('snippets/DefaultView');

    const toggleCall = vi
      .mocked(actionService.registerAction)
      .mock.calls.find(([call]) => call.id === 'snippets:toggle-private');
    expect(toggleCall).toBeDefined();

    const toggleAction = toggleCall![0];
    const toggleSpy = vi.spyOn(snippetStore, 'togglePrivate');
    await toggleAction.execute();

    expect(toggleSpy).toHaveBeenCalledWith('1');
    expect(snippetService.syncToRust).toHaveBeenCalled();
  });

  it('deactivate() cleans up keydown listener, resets view state, and unregisters actions', async () => {
    await snippetsExtension.viewActivated('snippets/DefaultView');
    await snippetsExtension.deactivate();

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:add');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:paste');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:edit');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:delete');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:copy-expansion');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:duplicate');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:toggle-pin');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:toggle-private');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:clear-all');
  });

  it('deactivate() is safe and idempotent when not in view', async () => {
    await snippetsExtension.deactivate();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('snippets:add');
  });
});
