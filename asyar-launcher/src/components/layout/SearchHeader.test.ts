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

  it('does not crash when exiting context mode in the same flush that unmounts the active view and clears its accessory', async () => {
    const ExtensionViewContainer = (await import('../extension/ExtensionViewContainer.svelte'))
      .default;
    const { flushSync } = await import('svelte');
    // @ts-expect-error svelte/internal/client has no public declaration file
    const $ = await import('svelte/internal/client');
    const { contextModeService } = await import('../../services/context/contextModeService.svelte');
    const { viewManager } = await import('../../services/extension/viewManager.svelte');

    const manifest = {
      id: 'agents',
      name: 'Agents',
      commands: [{ id: 'ask', component: 'AgentChatView' }],
    } as any;
    viewManager.init(new Map([['agents', manifest]]));

    contextModeService.registerProvider({
      id: 'agents:default',
      triggers: [],
      display: { name: 'AI', icon: '💬' },
      type: 'stream',
      onActivate: () => {
        viewManager.navigateToView('agents/AgentChatView');
      },
    });

    contextModeService.activate('agents:default', '');
    await searchBarAccessoryService.declare({
      extensionId: 'agents',
      commandId: 'ask',
      options,
      value: 'a',
    });

    const extensionManager = {
      getManifestById: () => manifest,
      getLoadedExtensionModule: () => ({
        AgentChatView: () => {},
      }),
    };

    function SingleRoot($$anchor: any, $$props: any) {
      $.push($$props, true, SingleRoot);
      const frag = $.comment();
      const node1 = $.first_child(frag);
      SearchHeader(node1, {
        get activeContext() {
          return contextModeService.activeContext
            ? {
                id: contextModeService.activeContext.provider.id,
                name: contextModeService.activeContext.provider.display.name,
                icon: contextModeService.activeContext.provider.display.icon,
              }
            : null;
        },
      });
      $.if(node1, ($$render: any) => {
        if (viewManager.activeView) {
          $$render((anchor: any) => {
            ExtensionViewContainer(anchor, {
              get activeView() {
                return viewManager.activeView!;
              },
              extensionManager,
            });
          });
        }
      });
      $.append($$anchor, frag);
      return $.pop({});
    }
    (SingleRoot as any)[$.FILENAME] = 'SingleRoot.svelte';

    const view = render(SingleRoot as any);
    expect(view.container.querySelector('.context-search-row')).not.toBeNull();
    expect(view.container.textContent).toContain('Asyar Assistant');

    expect(() =>
      flushSync(() => {
        contextModeService.deactivate();
        viewManager.goBack();
      }),
    ).not.toThrow();

    expect(view.container.querySelector('.context-search-row')).toBeNull();
    expect(view.container.querySelector('.search-input-row')).not.toBeNull();
    expect(view.container.textContent).not.toContain('Asyar Assistant');
  });
});
