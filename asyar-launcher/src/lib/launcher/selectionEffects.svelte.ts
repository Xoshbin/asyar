import { searchStores } from '../../services/search/stores/search.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { ActionContext } from 'asyar-sdk/contracts';
import { buildMappedItems } from '../searchResultMapper';
import type { ItemShortcut } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import type { LauncherState } from './launcherState.svelte';
import { commandService } from '../../services/extension/commandService.svelte';
import { warmIfTier2 } from '../../services/search/searchOrchestrator.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { aliasStore } from '../../built-in-features/aliases/aliasStore.svelte';

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

  // Effect 8: Map search results to display items.
  // Depends on commandService.liveSubtitles so it re-runs every time an
  // extension calls updateCommandMetadata (e.g. the Pomodoro countdown).
  $effect(() => {
    const { mappedItems, selectedOriginal } = buildMappedItems({
      searchItems: state.searchItems,
      activeContext: state.activeContext,
      shortcutStore: state.shortcuts,
      localSearchValue: state.localSearchValue,
      selectedIndex: state.selectedIndexVal,
      liveSubtitles: commandService.liveSubtitles,
      onError: (msg) => diagnosticsService.report({
        source: 'frontend', kind: 'action_failed', severity: 'error',
        retryable: false, context: { message: msg },
      }),
    });
    state.searchResultItemsMapped = mappedItems;
    state.currentSelectedItemOriginal = selectedOriginal;
  });

  // Effect 8b: Predictive warm — when a Tier 2 command row becomes selected,
  // fire a predictiveWarm dispatch so its iframe is cold-loading in parallel
  // with the user deciding to press Enter. warmIfTier2 is a no-op for
  // non-Tier-2 items, so this is safe to call on every selection change.
  $effect(() => {
    warmIfTier2(state.currentSelectedItemOriginal as unknown as { type?: string; extensionId?: string } | undefined);
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

  // Effect 10: Alias action registration for selected item.
  // Aliases apply only to indexed apps and commands (not live extension search
  // results). Reads aliasStore.byObjectId reactively so the label flips to
  // "Change Alias" the moment a registration completes.
  $effect(() => {
    const item = state.currentSelectedItemOriginal;
    if (item && (item.type === 'application' || item.type === 'command')) {
      const hasAlias = aliasStore.byObjectId.has(item.objectId);
      actionService.registerAction({
        id: 'aliases:assign',
        label: hasAlias ? 'Change Alias' : 'Assign Alias',
        icon: '🏷️',
        description: 'Assign a quick text alias',
        category: 'Aliases',
        extensionId: 'aliases',
        context: ActionContext.CORE,
        execute: async () => {
          state.assignAliasTarget = item;
          state.getBottomBar()?.closeActionList();
        },
      });
    } else {
      actionService.unregisterAction('aliases:assign');
    }
    return () => {
      actionService.unregisterAction('aliases:assign');
    };
  });
}
