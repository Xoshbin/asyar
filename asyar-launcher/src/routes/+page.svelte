<script lang="ts">
  import { onMount } from 'svelte';
  import { LauncherController } from '../lib/launcher/launcherController.svelte';
  import ExtensionViewContainer from '../components/extension/ExtensionViewContainer.svelte';
  import WorkerIframes from '../components/extension/WorkerIframes.svelte';
  import SearchResultsArea from '../components/layout/SearchResultsArea.svelte';
  import ShortcutCaptureOverlay from '../components/layout/ShortcutCaptureOverlay.svelte';
  import { AliasCapture } from '../built-in-features/aliases';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import BottomActionBar from '../components/layout/BottomActionBar.svelte';
  import ActionListPopup from '../components/layout/ActionListPopup.svelte';
  import ToastHost from '../components/feedback/ToastHost.svelte';
  import DialogHost from '../components/feedback/DialogHost.svelte';
  import FatalErrorDialog from '../components/feedback/FatalErrorDialog.svelte';
  import { isAnyModalOpen } from '../components/base/Modal.logic';
  import { createKeyboardHandlers } from '../lib/keyboard/launcherKeyboard';
  import { searchStores } from '../services/search/stores/search.svelte';
  import { searchService } from '../services/search/SearchService';
  import { searchOrchestrator } from '../services/search/searchOrchestrator.svelte';
  import extensionManager from '../services/extension/extensionManager.svelte';
  import { settingsService } from '../services/settings/settingsService.svelte';
  import {
    CompactSyncService,
    registerCompactSyncService,
  } from '../services/launcher/compactSyncService.svelte';
  import { runService } from '../services/run/runService.svelte';
  import { feedbackService } from '../services/feedback/feedbackService.svelte';
  import { logService } from '../services/log/logService';
  import { shellConsentService } from '../services/shell/shellConsentService.svelte';
  import ShellConsentDialog from '../components/shell/ShellConsentDialog.svelte';
  import { actionService } from '../services/action/actionService.svelte';
  import { commandArgumentsService } from '../services/search/commandArguments';
  import { resolveCommandArguments } from '../lib/ipc/argumentModelCommands';
  import { commandArgDefaultsGet } from '../lib/ipc/commandArgDefaultsCommands';
  import { argumentHintVersion } from '../lib/launcher/argumentHintVersion.svelte';
  import type { CommandArgument } from 'asyar-sdk/contracts';
  import { developerSettingsService } from '../services/settings/developerSettingsService.svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import CrashReportPrompt from '../components/feedback/CrashReportPrompt.svelte';
  import { crashPromptState } from '../services/feedback/crashPromptState.svelte';
  import UsageSharePrompt from '../components/feedback/UsageSharePrompt.svelte';
  import { usageSharePromptState } from '../services/feedback/usageSharePromptState.svelte';
  import { recordActiveDay } from '../lib/ipc/commands';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { authService } from '../services/auth/authService.svelte';
  import { runWhenIdle } from '../lib/idle';
  import { prewarmEmojiFont } from '../lib/emojiPrewarm';
  import '../resources/styles/style.css';

  // Instantiate the controller
  const controller = new LauncherController();

  // DOM refs needed for binding (though controller handles elite state)
  let searchInput = $state<HTMLInputElement | null>(null);
  let listContainer = $state<HTMLDivElement | undefined>(undefined);
  let bottomActionBarInstance = $state<ReturnType<typeof BottomActionBar>>();
  let isActionPanelOpen = $state(false);
  // Bound by SearchHeader when the accessory dropdown is rendered. Task 15
  // (⌘P) reads this through getAccessoryRef in the keyboard chain so the
  // shortcut works regardless of which element currently has focus.
  let accessoryRef = $state<{
    focus: () => void;
    openPopover: () => void;
    togglePopover: () => void;
  } | null>(null);

  // Compact launch-view synchronization — owns compactExpanded, sticky gate,
  // query-mirror and setLauncherHeight scheduling. See compactSyncService.
  const compactSync = new CompactSyncService({
    getInitialized: () => settingsService.initialized,
    getLaunchView: () => settingsService.currentSettings.appearance.launchView,
    getActiveView: () => controller.activeViewVal,
    getActiveContext: () => controller.activeContext,
    getLocalSearchValue: () => controller.localSearchValue,
    getIsSearchLoading: () => controller.isSearchLoadingVal,
    getCurrentDiagnosticSeverity: () => {
      const severity = feedbackService.current?.severity;
      return severity === 'progress' ? null : (severity ?? null);
    },
    getLastCompletedQuery: () => searchOrchestrator.lastCompletedQuery,
  });
  registerCompactSyncService(compactSync);
  const isCompactIdle = $derived(compactSync.isCompactIdle);

  // Link DOM refs to controller
  $effect(() => {
    controller.setSearchInput(searchInput);
  });
  $effect(() => {
    controller.setListContainer(listContainer);
  });
  $effect(() => {
    if (bottomActionBarInstance) controller.setBottomBar(bottomActionBarInstance);
  });

  // Keyboard orchestration
  const keyboard = createKeyboardHandlers({
    getSearchInput: () => controller.getSearchInput(),
    getLocalSearchValue: () => controller.localSearchValue,
    setLocalSearchValue: (v) => {
      controller.localSearchValue = v;
      searchStores.query = v;
    },
    getContextQuery: () => controller.contextQuery,
    setContextQuery: (v) => {
      controller.contextQuery = v;
    },
    getContextHint: () => controller.contextHint,
    getActiveContext: () => controller.activeContext,
    getSearchResultsLength: () => controller.searchResultItemsMapped.length,
    getSelectedItem: () => {
      const idx = controller.selectedIndexVal;
      const items = controller.searchResultItemsMapped;
      if (idx < 0 || idx >= items.length) return null;
      return items[idx];
    },
    getBottomBar: () => controller.getBottomBar(),
    getAccessoryRef: () => accessoryRef,
    handleEnterKey: () => controller.handleEnterKey(),
    handleContextDismiss: (clearAll) => controller.handleContextDismiss(clearAll),
    onBeforeHide: async () => {
      await searchService.saveIndex();
    },
    isCompactIdle: () => isCompactIdle,
    onCompactExpand: () => {
      compactSync.compactExpanded = true;
    },
  });

  function handleActionPanelClose() {
    isActionPanelOpen = false;
    if (!controller.assignShortcutTarget && !controller.assignAliasTarget) {
      keyboard.restoreSearchFocus({ select: true });
    }
  }

  // Run controller effects
  $effect(() => {
    controller.setupEffects();
  });

  // Global event listeners
  $effect(() => {
    const handleBlur = () => {
      compactSync.compactExpanded = false;
    };
    document.addEventListener('click', keyboard.maintainSearchFocus, true);
    window.addEventListener('keydown', keyboard.handleGlobalKeydown, true);
    window.addEventListener('blur', handleBlur);

    // Close the action popup when the panel hides — the NSPanel doesn't fire
    // DOM blur, so without this its keydown listener keeps swallowing arrows
    // and Enter on the next launcher invocation.
    let unlistenResignKey: UnlistenFn | null = null;
    let unlistenBecomeKey: UnlistenFn | null = null;
    listen('main_panel_did_resign_key', () => {
      if (isActionPanelOpen) {
        isActionPanelOpen = false;
        keyboard.restoreSearchFocus();
      }
    })
      .then((fn) => {
        unlistenResignKey = fn;
      })
      .catch((e) => logService.debug(`[+page] listen resign-key failed: ${e}`));

    // When the panel becomes key (e.g. after shortcut execution or window summon),
    // restore and select search focus if no modal is open.
    listen('main_panel_did_become_key', () => {
      if (!isAnyModalOpen(document) && !isActionPanelOpen) {
        keyboard.restoreSearchFocus({ select: true });
      }
    })
      .then((fn) => {
        unlistenBecomeKey = fn;
      })
      .catch((e) => logService.debug(`[+page] listen become-key failed: ${e}`));

    return () => {
      window.removeEventListener('keydown', keyboard.handleGlobalKeydown, true);
      document.removeEventListener('click', keyboard.maintainSearchFocus, true);
      window.removeEventListener('blur', handleBlur);
      unlistenResignKey?.();
      unlistenBecomeKey?.();
    };
  });

  // Compact-sync reactive drivers — each effect is a thin call into the
  // service so the dependencies (controller.*, searchOrchestrator.*,
  // settingsService.*) are tracked by Svelte's reactivity graph.
  $effect(() => {
    compactSync.updateSearchExpandSticky();
  });
  $effect(() => {
    compactSync.syncKeepExpanded();
  });
  $effect(() => {
    compactSync.applyLauncherHeight();
  });

  onMount(() => {
    // Warm the emoji font off the critical path — first paint and the
    // compactSync reveal own the first frames; the prewarm only needs to
    // happen before the user first sees emoji-bearing content.
    runWhenIdle(() => prewarmEmojiFont(), { timeout: 3000 });
    return compactSync.onMount();
  });

  onMount(() => {
    // Load any pending Ask-mode crash report on startup, pre-filling the
    // user's email if they are already signed in.
    void crashPromptState.load(authService.user?.email ?? undefined);

    // Re-check when Rust emits 'crash-report-pending' (e.g. if a second
    // launch triggers a new detection while the app is already running).
    // Hold the promise (not the resolved fn) so cleanup still unlistens even
    // if the component unmounts before `listen` resolves.
    const unlistenCrash = listen('crash-report-pending', () => {
      void crashPromptState.load(authService.user?.email ?? undefined);
    });
    unlistenCrash.catch((e) =>
      logService.debug(`[+page] listen crash-report-pending failed: ${e}`),
    );

    return () => {
      void unlistenCrash.then((unlisten) => unlisten()).catch(() => {});
    };
  });

  // Ask-mode usage share: Rust emits 'usage:pending-share' with the day to
  // confirm. Show the banner; the user decides whether to send.
  $effect(() => {
    const unlisten = listen<string>('usage:pending-share', (e) => {
      usageSharePromptState.show(e.payload);
    });
    unlisten.catch((e) => logService.debug(`[+page] listen usage:pending-share failed: ${e}`));
    return () => {
      void unlisten.then((fn) => fn()).catch(() => {});
    };
  });

  // Usage heartbeat: record an active day on startup and whenever the window
  // regains focus. Rust dedupes to one heartbeat/day, so this is cheap.
  $effect(() => {
    void recordActiveDay();
    const promise = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void recordActiveDay();
        if (!isAnyModalOpen(document) && !isActionPanelOpen) {
          keyboard.restoreSearchFocus({ select: true });
        }
      }
    });
    return () => {
      void promise.then((unlisten) => unlisten()).catch(() => {});
    };
  });

  // Argument-mode derived state. Svelte 5 runes in the service propagate
  // through this $derived into the SearchHeader props.
  const argumentMode = $derived(commandArgumentsService.active);
  // The chips have no room to explain a bad value, so it goes to the bottom
  // bar's feedback slot. An unfilled required field is not an error and says
  // so with its own border instead.
  const argumentFeedback = $derived(commandArgumentsService.feedbackMessage());

  // Ghost argument affordance: the selected result declares arguments, so
  // Tab (or a click on a hint chip) promotes it into argument mode.
  const argumentHint = $derived.by(() => {
    if (argumentMode || controller.activeViewVal || controller.activeContextChip) return false;
    // The chips belong to the highlighted row, and compact idle hides the
    // result list entirely, so there is no highlight for them to describe.
    if (isCompactIdle) return false;
    const idx = controller.selectedIndexVal;
    const items = controller.searchResultItemsMapped;
    if (idx < 0 || idx >= items.length) return false;
    return items[idx].hasArguments === true;
  });

  const argumentHintObjectId = $derived.by(() => {
    if (!argumentHint) return null;
    return controller.searchResultItemsMapped[controller.selectedIndexVal]?.object_id ?? null;
  });

  // With nothing typed, the search bar stands in the command's name rather than
  // the generic prompt, so the chips have something to trail and the row reads
  // as one sentence. Argument mode carries its own resolved title.
  const argumentCommandName = $derived.by(() => {
    if (argumentMode) return argumentMode.title;
    if (!argumentHint) return null;
    return controller.searchResultItemsMapped[controller.selectedIndexVal]?.title ?? null;
  });

  $effect(() => {
    commandArgumentsService.syncQuery(controller.localSearchValue);
  });

  // Argument entry belongs to the row it was started from, and so do any
  // values escaped out of it: moving the highlight ends the one and discards
  // the other.
  const selectedObjectId = $derived(
    controller.searchResultItemsMapped[controller.selectedIndexVal]?.object_id ?? null,
  );
  $effect(() => {
    commandArgumentsService.syncSelection(selectedObjectId);
  });

  // Per-argument chip schema, resolved once per object id. Manifest commands
  // resolve in a microtask; dynamic commands round-trip to the Rust registry,
  // during which the generic "Input…" chip renders as a fallback.
  type ArgHintSchema = {
    args: {
      name: string;
      label: string;
      type: string;
      options?: { value: string; title: string }[];
    }[];
    /** What `enter()` would seed, so the chips preview what Enter sends. */
    seeds: Record<string, string>;
  };
  // Only the highlighted row reads this, so a cap keeps a long session from
  // accumulating every command the user has arrowed past.
  const ARG_HINT_CACHE_MAX = 64;
  let argHintById = $state<Record<string, ArgHintSchema>>({});

  // A command's object id survives both a dynamic re-registration and a submit
  // that persists new defaults, so the id alone cannot tell a live entry from
  // a stale one — the version does.
  $effect(() => {
    argumentHintVersion();
    argHintById = {};
  });

  $effect(() => {
    const id = argumentHintObjectId;
    if (!id || argHintById[id]) return;
    void resolveArgHint(id);
  });

  async function resolveArgHint(id: string) {
    const resolvedAt = argumentHintVersion();
    try {
      const meta = await extensionManager.getCommandArgMeta(id);
      const declared = meta?.args ?? [];
      // Only dropdowns are persisted, so nothing else can be waiting in
      // storage, and the read is IPC on every row the highlight passes over,
      // so it stays off the commands that cannot use it.
      const persisted =
        meta && declared.some((a) => a.type === 'dropdown')
          ? ((await commandArgDefaultsGet(
              meta.extensionId,
              meta.commandId,
              meta.isDynamic === true,
            )) ?? {})
          : {};
      const resolved = await resolveCommandArguments({ args: declared, persisted, values: {} });
      const schema: ArgHintSchema = {
        args: declared.map((a) => ({
          name: a.name,
          label: a.placeholder?.trim() || a.name,
          type: a.type,
          options: a.data,
        })),
        seeds: resolved.seeds,
      };
      // A bump while this was in flight already emptied the cache: what was
      // just read is exactly what it threw away, so don't put it back.
      if (argumentHintVersion() !== resolvedAt) return;
      const base = Object.keys(argHintById).length >= ARG_HINT_CACHE_MAX ? {} : argHintById;
      argHintById = { ...base, [id]: schema };
    } catch {
      // Leaves the fallback chip in place.
    }
  }

  // Values stashed by an Escape win, then whatever `enter()` would seed;
  // untouched fields fall back to their hint label.
  const argumentHintFields = $derived.by(() => {
    const id = argumentHintObjectId;
    if (!id) return [];
    const schema = argHintById[id];
    if (!schema) return [];
    const stash = commandArgumentsService.stashFor(id);
    const flagged = commandArgumentsService.flaggedFor(id);
    return schema.args.map((a) => ({
      arg: {
        name: a.name,
        type: a.type,
        placeholder: a.label,
        data: a.options,
      } as CommandArgument,
      value: (stash?.[a.name] ?? schema.seeds[a.name] ?? '').trim(),
      // Only a stashed value was actually picked; a seed is one the launcher
      // chose, and a dropdown greys itself to say so.
      touched: stash?.[a.name] !== undefined,
      // Escaping out of the row does not settle what it was flagging.
      needsValue: flagged.has(a.name),
    }));
  });

  function handleArgHintClick(fieldIdx: number) {
    const idx = controller.selectedIndexVal;
    const item = controller.searchResultItemsMapped[idx];
    if (!item) return;
    // Same as the Tab path: the pending AI hint is left alone, since the chips
    // already render over it and it cannot be committed from argument mode.
    commandArgumentsService
      .enter(item.object_id)
      .then((ok) => {
        if (ok && fieldIdx > 0) commandArgumentsService.focusField(fieldIdx);
      })
      .catch((err) => {
        logService.error(`Failed to enter argument mode from hint: ${err}`);
      });
  }

  // Prefer the stable SearchResult.name; fall back to the rendered title
  // while the original is briefly null mid-refresh.
  const actionPopupHeaderName = $derived.by(() => {
    const original = controller.currentSelectedItemOriginal?.name;
    if (original) return original;
    const idx = controller.selectedIndexVal;
    const items = controller.searchResultItemsMapped;
    if (idx >= 0 && idx < items.length) return items[idx].title ?? null;
    return null;
  });
</script>

<!--
  Static 480px layout — intentionally window-height-independent. When Rust
  crops the NSWindow to 96 (compact), nothing in the tree reflows; WebKit
  presents a sub-rect of an already-composited layer. Using h-screen or any
  height-consuming flex would invalidate WebKit's layout on every resize,
  producing a 1–2 frame blank flash on first show.
-->
<div class="app-root" style="position: relative; width: 100%;">
  <!-- SearchHeader roots itself on .search-header, which owns the fixed
       position, --shell-header-h and --z-header. No wrapper needed. -->
  <SearchHeader
    bind:ref={searchInput}
    bind:accessoryRef
    bind:value={controller.localSearchValue}
    showBack={!!controller.activeViewVal}
    searchable={!(controller.activeViewVal && !controller.activeViewSearchableVal)}
    placeholder={controller.activeViewVal
      ? controller.activeViewSearchableVal
        ? 'Search...'
        : 'Press Escape to go back'
      : 'Search or type a command...'}
    activeContext={controller.activeContextChip}
    activeViewId={controller.activeViewVal}
    bind:contextQuery={controller.contextQuery}
    contextHint={controller.contextHintChip}
    {argumentMode}
    {argumentHint}
    {argumentHintFields}
    {argumentCommandName}
    onArgHintClick={handleArgHintClick}
    oninput={(e) => controller.handleSearchInput(e)}
    onkeydown={keyboard.handleKeydown}
    onclick={() => controller.handleBackClick()}
    oncontextDismiss={() => controller.handleChipDismiss()}
    oncontextQueryChange={(d) => controller.handleContextQueryChange(d)}
    onArgValueChange={(name, v) => commandArgumentsService.setValue(name, v)}
    onArgValueReset={(name) => commandArgumentsService.resetValue(name)}
    onArgFocusField={(idx) => commandArgumentsService.focusField(idx)}
    onArgFieldsBlur={() => commandArgumentsService.blurFields()}
    onArgNext={() => commandArgumentsService.next()}
    onArgPrev={() => commandArgumentsService.prev()}
    onArgSubmit={() => controller.submitArguments()}
    onArgExit={() => commandArgumentsService.exit()}
  />

  <div class="shell-content custom-scrollbar">
    {#if controller.activeViewVal}
      <ExtensionViewContainer activeView={controller.activeViewVal} {extensionManager} />
    {:else if !isCompactIdle}
      <SearchResultsArea
        items={controller.searchResultItemsMapped}
        selectedIndex={controller.selectedIndexVal}
        isSearchLoading={controller.isSearchLoadingVal}
        localSearchValue={controller.localSearchValue}
        showSections={controller.localSearchValue.trim() === ''}
        bind:listContainer
        onselect={(detail) => {
          if (isCompactIdle) return;
          const clickedIndex = controller.searchResultItemsMapped.findIndex(
            (item) => item.object_id === detail.item.object_id,
          );
          if (clickedIndex !== -1) {
            searchStores.selectedIndex = clickedIndex;
            controller.handleEnterKey();
          }
        }}
      />
    {/if}
  </div>

  {#if isActionPanelOpen}
    <ActionListPopup
      availableActions={bottomActionBarInstance?.getEnrichedActions() || []}
      selectedItemName={actionPopupHeaderName}
      inExtensionView={!!controller.activeViewVal}
      onclose={handleActionPanelClose}
    />
  {/if}

  <BottomActionBar
    bind:this={bottomActionBarInstance}
    selectedItem={controller.currentSelectedItemOriginal}
    isActionListOpen={isActionPanelOpen}
    {isCompactIdle}
    argumentValidationError={argumentFeedback}
    onactionListToggled={() => {
      if (isActionPanelOpen) {
        handleActionPanelClose();
      } else {
        actionService.refreshFiltered();
        isActionPanelOpen = true;
      }
    }}
    onactionListClosed={handleActionPanelClose}
    onexpand={() => {
      compactSync.compactExpanded = true;
    }}
  />

  {#if controller.assignShortcutTarget}
    <ShortcutCaptureOverlay
      target={controller.assignShortcutTarget}
      oncapture={() => {
        controller.assignShortcutTarget = null;
        keyboard.restoreSearchFocus();
      }}
      oncancel={() => {
        controller.assignShortcutTarget = null;
        keyboard.restoreSearchFocus();
      }}
    />
  {/if}

  {#if controller.assignAliasTarget}
    <AliasCapture
      objectId={controller.assignAliasTarget.objectId}
      itemName={controller.assignAliasTarget.name ?? ''}
      itemType={controller.assignAliasTarget.type === 'application' ? 'application' : 'command'}
      currentAlias={controller.assignAliasTarget.alias ?? undefined}
      onsave={() => {
        controller.assignAliasTarget = null;
        keyboard.restoreSearchFocus();
      }}
      oncancel={() => {
        controller.assignAliasTarget = null;
        keyboard.restoreSearchFocus();
      }}
    />
  {/if}

  <ToastHost />
  <DialogHost />
  <FatalErrorDialog />
  <CrashReportPrompt />
  <UsageSharePrompt />

  {#if import.meta.env.DEV || developerSettingsService.showInspector}
    {#await import('../components/dev/InspectorShell.svelte') then InspectorShellModule}
      <InspectorShellModule.default />
    {/await}
  {/if}

  {#if shellConsentService.activeRequest}
    {@const request = shellConsentService.activeRequest}
    {@const manifest = extensionManager.getManifestById(request.extensionId)}
    <ShellConsentDialog
      extensionName={manifest?.name ?? request.extensionId}
      extensionIcon={manifest?.icon
        ? `asyar-icon://${request.extensionId}/${manifest.icon}`
        : undefined}
      program={request.program}
      resolvedPath={request.resolvedPath}
      onAllow={() => shellConsentService.approveCurrent()}
      onDeny={() => shellConsentService.denyCurrent()}
    />
  {/if}
</div>

<WorkerIframes />

<style>
  /*
   * Non-macOS: visible styled scrollbar.
   * macOS: NO ::-webkit-scrollbar rule at all — defining one (even
   * width:0) opts WebKit out of the native NSScroller overlay
   * scrollbar, switching it to legacy obtrusive mode. Leaving the
   * default keeps the real macOS overlay scrollbar that fades in
   * on scroll, controlled by System Settings → "Show scroll bars".
   */
  :global(html:not([data-platform='macos']) ::-webkit-scrollbar) {
    width: 8px;
    height: 8px;
  }
  :global(html:not([data-platform='macos']) ::-webkit-scrollbar-track) {
    background: transparent;
  }
  :global(html:not([data-platform='macos']) ::-webkit-scrollbar-thumb) {
    background-color: var(--scrollbar-thumb);
    border-radius: var(--radius-md);
  }
</style>
