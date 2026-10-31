// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../index', async () => ({
  Badge: (await import('../base/Badge.svelte')).default,
  Input: (await import('../base/Input.svelte')).default,
  SearchBarAccessoryDropdown: (await import('../search/SearchBarAccessoryDropdown.svelte')).default,
}));

import SearchHeader from './SearchHeader.svelte';
import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';

describe('SearchHeader context hints', () => {
  it('previews a portal prefix as the input that Tab will enter', () => {
    const view = render(SearchHeader, {
      value: 'search goo',
      contextHint: {
        id: 'portal_google',
        name: 'Search Google',
        icon: '🌐',
        type: 'prefix',
      },
    });

    expect(view.container.querySelector('.arg-hint-row .arg-ghost-text')?.textContent).toBe(
      'Input…',
    );
    expect(view.container.querySelector('.context-hint')).toBeNull();
    expect(view.container.querySelector('kbd')).toBeNull();
  });

  it('keeps the AI affordance on the right with its ⇥ key hint', () => {
    const view = render(SearchHeader, {
      value: 'hi there',
      contextHint: {
        id: 'ai',
        name: 'AI',
        icon: '💬',
        type: 'ai',
      },
    });

    expect(view.container.querySelector('.context-hint .hint-label')?.textContent).toBe('Ask AI');
    expect(view.container.querySelector('.context-hint kbd')?.textContent?.trim()).toBe('⇥');
    expect(view.container.querySelector('.arg-ghost-text')).toBeNull();
  });
});

describe('SearchHeader searchbar accessory', () => {
  const options = [
    { value: 'a', title: 'Asyar Assistant' },
    { value: 'b', title: 'Research' },
  ];

  it('shows the active view accessory inside a context too (Ask AI runs in the AI context)', async () => {
    await searchBarAccessoryService.declare({
      extensionId: 'agents',
      commandId: 'ask',
      options,
      value: 'a',
    });
    const view = render(SearchHeader, {
      activeContext: { id: 'agents:default', name: 'AI', icon: '💬' },
    });

    expect(view.container.querySelector('.context-search-row')).not.toBeNull();
    expect(view.container.textContent).toContain('Asyar Assistant');
    searchBarAccessoryService.clear();
  });

  it('shows no accessory when none is declared', () => {
    searchBarAccessoryService.clear();
    const view = render(SearchHeader, {
      activeContext: { id: 'agents:default', name: 'AI', icon: '💬' },
    });
    expect(view.container.textContent).not.toContain('Asyar Assistant');
  });
});
