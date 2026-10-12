// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../index', async () => ({
  Badge: (await import('../base/Badge.svelte')).default,
  Input: (await import('../base/Input.svelte')).default,
  SearchBarAccessoryDropdown: (await import('../search/SearchBarAccessoryDropdown.svelte')).default,
}));

import SearchHeader from './SearchHeader.svelte';

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

  it('keeps the AI affordance on the right with its Tab key hint', () => {
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
    expect(view.container.querySelector('.context-hint kbd')?.textContent?.trim()).toBe('Tab');
    expect(view.container.querySelector('.arg-ghost-text')).toBeNull();
  });
});
