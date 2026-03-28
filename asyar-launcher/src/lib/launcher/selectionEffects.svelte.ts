import { searchStores } from '../../services/search/stores/search.svelte';
import { actionService } from '../../services/action/actionService';
import { ActionContext } from 'asyar-sdk';
import { buildMappedItems } from '../searchResultMapper';
import type { ItemShortcut } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import type { LauncherState } from './launcherState.svelte';

export function setupSelectionEffects(state: LauncherState) {
  // Effect 6: Reset selected index when search items change
  $effect(() => {
    searchStores.selectedIndex = state.searchItems.length > 0 ? 0 : -1;
  });

  // Effect 7: Extension view cleanup
  $effect(() => {
    const currentView = state.activeViewVal;
    if (state.lastActiveViewId !== null && currentView === null) {
      const closedExtensionId = state.lastActiveViewId.split('/')[0];
      actionService.clearActionsForExtension(closedExtensionId);
    }
    state.lastActiveViewId = currentView;
    actionService.setContext(currentView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE);
  });

  // Effect 8: Map search results to display items
  $effect(() => {
    const { mappedItems, selectedOriginal } = buildMappedItems({
      searchItems: state.searchItems,
      activeContext: state.activeContext,
      shortcutStore: state.shortcuts,
      localSearchValue: state.localSearchValue,
      selectedIndex: state.selectedIndexVal,
      onError: (msg) => { state.currentError = msg; },
    });
    state.searchResultItemsMapped = mappedItems;
    state.currentSelectedItemOriginal = selectedOriginal;
  });

  // Effect 9: Shortcut action registration for selected item
  $effect(() => {
    if (state.currentSelectedItemOriginal) {
      const item = state.currentSelectedItemOriginal;
      actionService.registerAction({
        id: 'shortcuts:assign',
        label: state.shortcuts.some((s: ItemShortcut) => s.objectId === item.objectId) ? 'Change Shortcut' : 'Assign Shortcut',
        icon: '⌨️',
        description: 'Assign global shortcut',
        category: 'Shortcuts',
        extensionId: 'shortcuts',
        context: ActionContext.CORE,
        execute: async () => {
          state.assignShortcutTarget = item;
          state.getBottomBar()?.closeActionList();
        }
      });
    } else {
      actionService.unregisterAction('shortcuts:assign');
    }
    return () => {
      actionService.unregisterAction('shortcuts:assign');
    };
  });
}
