import { untrack } from 'svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { ActionContext } from 'asyar-sdk/contracts';
import { buildMappedItems } from '../searchResultMapper';
import { sortBySectionOrder } from '../../components/list/sectionedListLogic';
import type { ItemShortcut } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import type { LauncherState } from './launcherState.svelte';
import { commandService } from '../../services/extension/commandService.svelte';
import { warmIfTier2 } from '../../services/search/searchOrchestrator.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { aliasStore } from '../../built-in-features/aliases/aliasStore.svelte';
import { runService } from '../../services/run/runService.svelte';

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
      query: state.localSearchValue,
      onError: (msg) => diagnosticsService.report({
        source: 'frontend', kind: 'action_failed', severity: 'error',
        retryable: false, context: { message: msg },
      }),
    });
    // Reorder so visual order matches sectioned order — keeps ArrowUp/Down
    // walking through visually adjacent rows once a script promotes into
    // Failed/Done/Active. SectionedResultsList then just inserts headers
    // between the already-sorted runs.
    const sorted = sortBySectionOrder(
      mappedItems,
      runService.active,
      runService.unacknowledgedFailures,
      runService.unacknowledgedScriptResults,
    );

    // Pin highlight to the previously-selected item across reorders (e.g. a
    // script promotes Done → Active and its row moves up the list). Effect 6
    // still handles new-search-query resets — it watches state.searchItems,
    // not the mapped/sorted array. untrack() because this effect both reads
    // and writes searchResultItemsMapped/selectedIndex.
    untrack(() => {
      const prev = state.searchResultItemsMapped;
      const prevIdx = state.selectedIndexVal;
      if (prevIdx >= 0 && prevIdx < prev.length) {
        const prevId = prev[prevIdx].object_id;
        const newIdx = sorted.findIndex((i) => i.object_id === prevId);
        if (newIdx >= 0 && newIdx !== prevIdx) {
          searchStores.selectedIndex = newIdx;
        }
      }
    });

    state.searchResultItemsMapped = sorted;
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
        icon: 'icon:keyboard',
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

  // Effect 9b: Run-specific actions when a run row is selected.
  // Runs aren't backed by SearchResult entries (currentSelectedItemOriginal is
  // null for run rows), so we look up the run from the mapped item's object_id.
  $effect(() => {
    const items = state.searchResultItemsMapped;
    const idx = state.selectedIndexVal;
    const item = idx >= 0 && idx < items.length ? items[idx] : null;

    if (item && item.type === 'run') {
      const runId = item.object_id.replace(/^run_/, '');
      const run = runService.active.find((r) => r.id === runId);
      if (run && run.cancellable) {
        actionService.registerAction({
          id: 'runs:cancel',
          label: 'Cancel Run',
          icon: 'icon:trash',
          description: 'Cancel this running task',
          category: 'Runs',
          extensionId: 'runs',
          context: ActionContext.CORE,
          shortcut: 'Control+C',
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
        label: 'Dismiss Failure',
        icon: 'icon:trash',
        description: 'Remove this failed run from the launcher list (still kept in history)',
        category: 'Runs',
        extensionId: 'runs',
        context: ActionContext.CORE,
        shortcut: 'Control+D',
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
        category: 'Runs',
        extensionId: 'runs',
        context: ActionContext.CORE,
        shortcut: 'Control+D',
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

    // Attributed runs: when a `scriptResultRuns` / `keptAgents` entry's
    // subjectId matches a definition row in the search results, the mapper
    // dedupes the standalone `run-done` row and merges its tail-output subtitle
    // into the definition row instead (see searchResultMapper.ts isAttributed).
    // That means the visible row is a `command` (or other definition type),
    // not `run-done` — so without this branch, Cmd+K shows no Dismiss action
    // for completed scripts/threads that are still attached to their command.
    if (item && item.object_id) {
      const attributedDone =
        runService.unacknowledgedScriptResults.find((r) => r.subjectId === item.object_id) ??
        runService.keptAgents.find((r) => r.subjectId === item.object_id);
      if (attributedDone) {
        const runId = attributedDone.id;
        const isScript = attributedDone.kind === 'shell-script';
        actionService.registerAction({
          id: 'runs:dismiss',
          label: isScript ? 'Dismiss Result' : 'Dismiss Thread',
          icon: 'icon:trash',
          description: isScript
            ? 'Remove this script result row and free its output (history record is kept)'
            : 'Remove this completed thread from the launcher list (still kept in history)',
          category: 'Runs',
          extensionId: 'runs',
          context: ActionContext.CORE,
          shortcut: 'Control+D',
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

      const attributedFailed = runService.unacknowledgedFailures.find(
        (r) => r.subjectId === item.object_id,
      );
      if (attributedFailed) {
        const runId = attributedFailed.id;
        actionService.registerAction({
          id: 'runs:dismiss',
          label: 'Dismiss Failure',
          icon: 'icon:trash',
          description: 'Remove this failed run from the launcher list (still kept in history)',
          category: 'Runs',
          extensionId: 'runs',
          context: ActionContext.CORE,
          shortcut: 'Control+D',
          execute: async () => {
            runService.dismissFailure(runId);
            state.getBottomBar()?.closeActionList();
          },
        });
        return () => {
          actionService.unregisterAction('runs:dismiss');
        };
      }

      const attributedActive = runService.active.find((r) => r.subjectId === item.object_id);
      if (attributedActive && attributedActive.cancellable) {
        const runId = attributedActive.id;
        actionService.registerAction({
          id: 'runs:cancel',
          label: 'Cancel Run',
          icon: 'icon:trash',
          description: 'Cancel this running task',
          category: 'Runs',
          extensionId: 'runs',
          context: ActionContext.CORE,
          shortcut: 'Control+C',
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

    actionService.unregisterAction('runs:cancel');
    actionService.unregisterAction('runs:dismiss');
    return () => {
      actionService.unregisterAction('runs:cancel');
      actionService.unregisterAction('runs:dismiss');
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
        icon: 'icon:tag',
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
