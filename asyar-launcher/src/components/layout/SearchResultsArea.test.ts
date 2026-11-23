// @vitest-environment jsdom
import { render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SearchResultsArea from './SearchResultsArea.svelte';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

describe('search result context menu', () => {
  it.each([true, false])('requests Actions for the clicked app (sections: %s)', (showSections) => {
    const items = [
      { object_id: 'steam', title: 'Steam', type: 'application' },
      { object_id: 'firefox', title: 'Firefox', type: 'application', favorite: true },
    ];
    const onselect = vi.fn();
    const onopenactions = vi.fn();
    const { container } = render(SearchResultsArea, {
      items,
      selectedIndex: 0,
      isSearchLoading: false,
      localSearchValue: showSections ? '' : 'f',
      showSections,
      onselect,
      onopenactions,
    });
    const title = within(container).getByText('Firefox');
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    title.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(onopenactions).toHaveBeenCalledExactlyOnceWith(1);
    expect(onselect).not.toHaveBeenCalled();

    title.click();
    expect(onselect).toHaveBeenCalledWith({ item: items[1] });
    expect(onopenactions).toHaveBeenCalledTimes(1);
    if (showSections) {
      const headerMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      within(container).getByText('Favorites').dispatchEvent(headerMenu);
      expect(headerMenu.defaultPrevented).toBe(false);
      expect(onopenactions).toHaveBeenCalledTimes(1);
    }
  });
});
