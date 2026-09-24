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

import snippetsExtension from './index';
import { snippetStore } from './snippetStore.svelte';
import { snippetViewState } from './snippetViewState.svelte';
import { rankItems } from '../../lib/rankItems';
import { isAnyModalOpen } from '../../components/base/Modal.logic';
import { snippetService } from './snippetService';

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
