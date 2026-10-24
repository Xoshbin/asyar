import { t } from '../../services/i18n';
import { searchStores } from '../../services/search/stores/search.svelte';
import { getCompactSyncService } from '../../services/launcher/compactSyncService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { ActionContext } from 'asyar-sdk/contracts';
import { buildMappedItems } from '../searchResultMapper';
import { classifyItems } from '../classifyItems';
import type { Run } from 'asyar-sdk/contracts';
import type { ItemShortcut } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import type { LauncherState } from './launcherState.svelte';
import { commandService } from '../../services/extension/commandService.svelte';
import * as commands from '../../lib/ipc/commands';
import {
  warmIfTier2,
  searchOrchestrator,
  invalidateTopItemsCache,
} from '../../services/search/searchOrchestrator.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { aliasStore } from '../../built-in-features/aliases/aliasStore.svelte';
import { runService } from '../../services/run/runService.svelte';
import { untrack } from 'svelte';
import { createRootFileIconCache } from './rootFileIcons.svelte';
import { buildFileActions } from '../../built-in-features/file-search/fileActions';

export function setupSelectionEffects(state: LauncherState) {
  const rootFileIcons = createRootFileIconCache();
  // Effect 6: Reset selected index when search items change.
  //
  // Compact idle has no visible list, so it has no selection either: a
  // highlight the user cannot see still answers Tab and Enter, promoting a
  // command they never picked. Expanding the list — Show More, arrowing
  // down, a query that settles — hands the highlight back to the first row.
  $effect(() => {
    const hidden = getCompactSyncService()?.isCompactIdle === true;
    searchStores.selectedIndex = !hidden && state.searchItems.length > 0 ? 0 : -1;
  });

  // Effect 7: Extension view cleanup
  $effect(() => {
    const currentView = state.activeViewVal;
    const currentExtId = currentView ? currentView.split('/')[0] : undefined;
    const previousExtId = state.lastActiveViewId ? state.lastActiveViewId.split('/')[0] : undefined;

    if (previousExtId && previousExtId !== currentExtId) {
      actionService.clearActionsForExtension(previousExtId);
    }
    state.lastActiveViewId = currentView;
    actionService.setContext(
      currentView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE,
      currentExtId,
    );
  });

  // Effect 7b: Classify run rows against the live query via Rust's shared
  // tiered ranker. Runs aren't in the Rust search index, so they have no
  // SearchResult.tier — this batches all of them into one classifyItems
  // round-trip per query change so Effect 8 can interleave them by real tier
  // instead of a TS-side substring guess. `runTierMap` is a snapshot from the
  // last resolved round-trip; the staleness guard discards a response if a
  // newer keystroke has since changed the query (mirrors the rankItems
  // snapshot pattern used by snippets/store).
  let runTierMap = $state(new Map<string, number>());
  $effect(() => {
    const q = state.localSearchValue.trim();
    const runs: Run[] = [
      ...runService.active,
      ...runService.unacknowledgedFailures,
      ...runService.keptAgents,
      ...runService.unacknowledgedScriptResults,
    ];
    if (!q || runs.length === 0) {
      runTierMap = new Map();
      return;
    }
    classifyItems(q, runs, { id: (r) => r.id, title: (r) => r.label }).then((map) => {
      if (state.localSearchValue.trim() !== q) return;
      runTierMap = map;
    });
  });

  // Effect 8: Map search results to display items.
  // Depends on commandService.liveSubtitles so it re-runs every time an
  // extension calls updateCommandMetadata (e.g. the Pomodoro countdown).
  // Also depends on runService.active so active runs are injected as the
  // top items and re-rendered as runs start/finish.
  $effect(() => {
    const { mappedItems, selectedOriginal } = buildMappedItems({
      searchItems: state.searchItems,
      activeContext: state.activeContext,
      shortcutStore: state.shortcuts,
      localSearchValue: state.localSearchValue,
      selectedIndex: state.selectedIndexVal,
      liveSubtitles: commandService.liveSubtitles,
      activeRuns: runService.active,
      failedRuns: runService.unacknowledgedFailures,
      keptAgentRuns: runService.keptAgents,
      scriptResultRuns: runService.unacknowledgedScriptResults,
      runTiers: runTierMap,
      query: state.localSearchValue,
      onError: (msg) =>
        feedbackService.report({
          source: 'frontend',
          kind: 'action_failed',
          severity: 'error',
          retryable: false,
          context: { message: msg },
        }),
    });
    state.searchResultItemsMapped = mappedItems;
    state.currentSelectedItemOriginal = selectedOriginal;
  });

  $effect(() => {
    const fileRows = state.searchResultItemsMapped.filter((item) => item.type === 'file');
    for (const row of fileRows) {
      const icon = rootFileIcons.iconFor(row.object_id);
      if (icon) row.icon = icon;
    }
    rootFileIcons.request(fileRows);
  });

  // Effect 8b: Predictive warm — when a Tier 2 command row becomes selected,
  // fire a predictiveWarm dispatch so its iframe is cold-loading in parallel
  // with the user deciding to press Enter. warmIfTier2 is a no-op for
  // non-Tier-2 items, so this is safe to call on every selection change.
  $effect(() => {
    warmIfTier2(
      state.currentSelectedItemOriginal as unknown as
        { type?: string; extensionId?: string } | undefined,
    );
  });

  const shortcutsKey = $derived.by(() => {
    const item = state.currentSelectedItemOriginal;
    if (!item) return null;
    const hasShortcut = state.shortcuts.some(
      (shortcut: ItemShortcut) => shortcut.objectId === item.objectId,
    );
    return `${item.objectId}:${hasShortcut}`;
  });

  const runsKey = $derived.by(() => {
    const items = state.searchResultItemsMapped;
    const idx = state.selectedIndexVal;
    const item = idx >= 0 && idx < items.length ? items[idx] : null;
    if (!item) return null;

    const runId = item.object_id.replace(/^run_/, '');
    if (item.type === 'run') {
      const run = runService.active.find((candidate) => candidate.id === runId);
      return run?.cancellable ? `cancel:${runId}` : null;
    }
    if (item.type === 'run-failed') return `dismiss-failed:${runId}`;
    if (item.type === 'run-done') {
      const matchingRun =
        runService.unacknowledgedScriptResults.find((candidate) => candidate.id === runId) ??
        runService.keptAgents.find((candidate) => candidate.id === runId);
      return `dismiss-done:${runId}:${matchingRun?.kind === 'shell-script'}`;
    }
    return null;
  });

  const aliasesKey = $derived.by(() => {
    const item = state.currentSelectedItemOriginal;
    if (!item || (item.type !== 'application' && item.type !== 'command')) return null;
    return `${item.objectId}:${aliasStore.byObjectId.has(item.objectId)}`;
  });

  const favoriteKey = $derived.by(() => {
    const item = state.currentSelectedItemOriginal;
    if (
      !item ||
      (item.type !== 'application' && item.type !== 'command') ||
      (!item.objectId.startsWith('app_') && !item.objectId.startsWith('cmd_'))
    ) {
      return null;
    }
    return `${item.objectId}:${item.favorite === true}`;
  });

  const rootFileActionsKey = $derived.by(() => {
    if (state.activeViewVal) return null;
    const items = state.searchResultItemsMapped;
    const index = state.selectedIndexVal;
    const item = index >= 0 && index < items.length ? items[index] : null;
    return item?.type === 'file' && item.path ? item.object_id : null;
  });

  const rowActionsItem = $derived.by(() => {
    const item = state.currentSelectedItemOriginal;
    return item?.rowActions?.length ? item : null;
  });

  // Effect 9d: ⌘K actions a built-in contributes for its own selected root
  // row (e.g. the calculator's "Copy as HEX / RGB / HSL"). The row carries
  // them, so they always match the query that produced it.
  $effect(() => {
    const item = rowActionsItem;
    if (!item?.rowActions) return;
    const ids: string[] = [];
    for (const action of item.rowActions) {
      ids.push(action.id);
      actionService.registerAction({
        id: action.id,
        label: action.label,
        description: action.description,
        icon: action.icon,
        category: action.category,
        extensionId: item.extensionId ?? undefined,
        context: ActionContext.CORE,
        execute: async () => {
          await action.execute();
          state.getBottomBar()?.closeActionList();
        },
      });
    }
    return () => {
      for (const id of ids) actionService.unregisterAction(id);
    };
  });

  // Effect 9: Shortcut action registration for selected item
  $effect(() => {
    const key = shortcutsKey;
    if (key === null) return;
    const item = untrack(() => state.currentSelectedItemOriginal);
    if (!item) return;
    actionService.registerAction({
      id: 'shortcuts:assign',
      label: untrack(() => state.shortcuts).some(
        (shortcut: ItemShortcut) => shortcut.objectId === item.objectId,
      )
        ? t('selection_actions.change_shortcut')
        : t('selection_actions.assign_shortcut'),
      icon: 'icon:keyboard',
      description: t('selection_actions.assign_shortcut_desc'),
      category: t('categories.shortcuts'),
      extensionId: 'shortcuts',
      context: ActionContext.CORE,
      execute: async () => {
        state.assignShortcutTarget = item;
        state.getBottomBar()?.closeActionList();
      },
    });
    return () => {
      actionService.unregisterAction('shortcuts:assign');
    };
  });

  // Effect 9c: The root file row uses the same action descriptors as the
  // dedicated File Search view. Cleanup is context-aware so a root effect
  // teardown cannot unregister actions the view has just registered.
  $effect(() => {
    const key = rootFileActionsKey;
    if (key === null) return;
    const getFile = () => {
      const items = state.searchResultItemsMapped;
      const index = state.selectedIndexVal;
      const item = index >= 0 && index < items.length ? items[index] : null;
      if (!item || item.type !== 'file' || !item.path) return null;
      return {
        fileId: item.object_id.replace(/^file_/, ''),
        path: item.path,
        name: item.title,
      };
    };
    const actions = buildFileActions({ getFile, context: ActionContext.CORE });
    for (const action of actions) actionService.registerAction(action);
    return () => {
      if (actionService.getContext() !== ActionContext.CORE) return;
      for (const action of actions) actionService.unregisterAction(action.id);
    };
  });

  // Effect 9b: Run-specific actions when a run row is selected.
  // Runs aren't backed by SearchResult entries (currentSelectedItemOriginal is
  // null for run rows), so we look up the run from the mapped item's object_id.
  $effect(() => {
    const key = runsKey;
    if (key === null) return;
    const items = untrack(() => state.searchResultItemsMapped);
    const idx = untrack(() => state.selectedIndexVal);
    const item = idx >= 0 && idx < items.length ? items[idx] : null;

    if (item && item.type === 'run') {
      const runId = item.object_id.replace(/^run_/, '');
      const run = runService.active.find((r) => r.id === runId);
      if (run && run.cancellable) {
        actionService.registerAction({
          id: 'runs:cancel',
          label: t('selection_actions.cancel_run'),
          icon: 'icon:trash',
          description: t('selection_actions.cancel_run_desc'),
          category: t('categories.runs'),
          extensionId: 'runs',
          context: ActionContext.CORE,
          execute: async () => {
            await runService.cancelById(runId);
            state.getBottomBar()?.closeActionList();
          },
        });
        return () => {
          actionService.unregisterAction('runs:cancel');
        };
      }
    }

    if (item && item.type === 'run-failed') {
      const runId = item.object_id.replace(/^run_/, '');
      actionService.registerAction({
        id: 'runs:dismiss',
        label: t('selection_actions.dismiss_failure'),
        icon: 'icon:trash',
        description: t('selection_actions.dismiss_failure_desc'),
        category: t('categories.runs'),
        extensionId: 'runs',
        context: ActionContext.CORE,
        execute: async () => {
          runService.dismissFailure(runId);
          state.getBottomBar()?.closeActionList();
        },
      });
      return () => {
        actionService.unregisterAction('runs:dismiss');
      };
    }

    if (item && item.type === 'run-done') {
      const runId = item.object_id.replace(/^run_/, '');
      const matchingRun =
        runService.unacknowledgedScriptResults.find((r) => r.id === runId) ??
        runService.keptAgents.find((r) => r.id === runId);
      const isScript = matchingRun?.kind === 'shell-script';
      actionService.registerAction({
        id: 'runs:dismiss',
        label: isScript ? 'Dismiss Result' : 'Dismiss Thread',
        icon: 'icon:trash',
        description: isScript
          ? 'Remove this script result row and free its output (history record is kept)'
          : 'Remove this completed thread from the launcher list (still kept in history)',
        category: t('categories.runs'),
        extensionId: 'runs',
        context: ActionContext.CORE,
        execute: async () => {
          if (isScript) {
            runService.dismissScriptResult(runId);
          } else {
            runService.dismissKeptAgent(runId);
          }
          state.getBottomBar()?.closeActionList();
        },
      });
      return () => {
        actionService.unregisterAction('runs:dismiss');
      };
    }
  });

  // Effect 10: Alias action registration for selected item.
  // Aliases apply only to indexed apps and commands (not live extension search
  // results). Reads aliasStore.byObjectId reactively so the label flips to
  // "Change Alias" the moment a registration completes.
  $effect(() => {
    const key = aliasesKey;
    if (key === null) return;
    const item = untrack(() => state.currentSelectedItemOriginal);
    if (!item) return;
    const hasAlias = untrack(() => aliasStore.byObjectId.has(item.objectId));
    actionService.registerAction({
      id: 'aliases:assign',
      label: hasAlias ? t('selection_actions.change_alias') : t('selection_actions.assign_alias'),
      icon: 'icon:tag',
      description: t('selection_actions.assign_alias_desc'),
      category: t('categories.aliases'),
      extensionId: 'aliases',
      context: ActionContext.CORE,
      execute: async () => {
        state.assignAliasTarget = item;
        state.getBottomBar()?.closeActionList();
      },
    });
    return () => {
      actionService.unregisterAction('aliases:assign');
    };
  });

  // Effect 10b: Favorite / unfavorite action registration for selected item.
  // Favorites apply only to indexed applications and commands.
  $effect(() => {
    const key = favoriteKey;
    if (key === null) return;
    const item = untrack(() => state.currentSelectedItemOriginal);
    if (!item) return;
    const actionId = item.favorite ? 'unfavorite_item' : 'favorite_item';
    actionService.registerAction({
      id: actionId,
      label: item.favorite ? t('selection_actions.unfavorite') : t('selection_actions.favorite'),
      icon: 'icon:star',
      description: item.favorite
        ? t('selection_actions.unfavorite_desc')
        : t('selection_actions.favorite_desc'),
      category: t('categories.item'),
      context: ActionContext.CORE,
      execute: async () => {
        const updated = await commands.setItemFavorite(item.objectId, !item.favorite);
        if (!updated) return;
        invalidateTopItemsCache();
        await searchOrchestrator.handleSearch(searchStores.query || '');
        state.getBottomBar()?.closeActionList();
      },
    });

    return () => {
      actionService.unregisterAction(actionId);
    };
  });
}
