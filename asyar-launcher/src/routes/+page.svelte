<script lang="ts">
  import { onMount } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { LauncherController } from '../lib/launcher/launcherController.svelte';
  import ExtensionViewContainer from '../components/extension/ExtensionViewContainer.svelte';
  import BackgroundExtensionIframes from '../components/extension/BackgroundExtensionIframes.svelte';
  import SearchResultsArea from '../components/layout/SearchResultsArea.svelte';
  import ShortcutCaptureOverlay from '../components/layout/ShortcutCaptureOverlay.svelte';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import BottomActionBar from '../components/layout/BottomActionBar.svelte';
  import ActionListPopup from '../components/layout/ActionListPopup.svelte';
  import ToastHost from '../components/feedback/ToastHost.svelte';
  import DialogHost from '../components/feedback/DialogHost.svelte';
  import { createKeyboardHandlers } from '../lib/keyboard/launcherKeyboard';
  import { searchStores } from '../services/search/stores/search.svelte';
  import { searchService } from '../services/search/SearchService';
  import { searchOrchestrator } from '../services/search/searchOrchestrator.svelte';
  import extensionManager from '../services/extension/extensionManager.svelte';
  import { settingsService } from '../services/settings/settingsService.svelte';
  import { setLauncherHeight, markLauncherReady, setLauncherHasQuery } from '../lib/ipc/commands';
  import { startNativeBarStyleSync } from '../services/theme/nativeBarSync';
  import { logService } from '../services/log/logService';
  import { shellConsentService } from '../services/shell/shellConsentService.svelte';
  import ShellConsentDialog from '../components/shell/ShellConsentDialog.svelte';
  import { actionService } from '../services/action/actionService.svelte';
  import WhatsNewPanel from '../components/feedback/WhatsNewPanel.svelte';
  import { whatsNewStore } from '../services/update/whatsNewStore.svelte';
  import '../resources/styles/style.css';

  const WINDOW_HEIGHT_DEFAULT = 560;
  const WINDOW_HEIGHT_COMPACT = 96; // SearchHeader (56px) + BottomActionBar (40px)

  // Instantiate the controller
  const controller = new LauncherController();

  // DOM refs needed for binding (though controller handles elite state)
  let searchInput = $state<HTMLInputElement | null>(null);
  let listContainer = $state<HTMLDivElement | undefined>(undefined);
  let bottomActionBarInstance = $state<ReturnType<typeof BottomActionBar>>();
  let isActionPanelOpen = $state(false);
  let compactExpanded = $state(false); // temporarily expand compact mode until next hide

  // Link DOM refs to controller
  $effect(() => { controller.setSearchInput(searchInput); });
  $effect(() => { controller.setListContainer(listContainer); });
  $effect(() => { if (bottomActionBarInstance) controller.setBottomBar(bottomActionBarInstance); });

  // Keyboard orchestration
  const keyboard = createKeyboardHandlers({
    getSearchInput: () => controller.getSearchInput(),
    getLocalSearchValue: () => controller.localSearchValue,
    setLocalSearchValue: (v) => { controller.localSearchValue = v; searchStores.query = v; },
    getContextQuery: () => controller.contextQuery,
    setContextQuery: (v) => { controller.contextQuery = v; },
    getContextHint: () => controller.contextHint,
    getActiveContext: () => controller.activeContext,
    getSearchResultsLength: () => controller.searchResultItemsMapped.length,
    getBottomBar: () => controller.getBottomBar(),
    handleEnterKey: () => controller.handleEnterKey(),
    handleContextDismiss: (clearAll) => controller.handleContextDismiss(clearAll),
    onBeforeHide: async () => {
      await searchService.saveIndex();
    },
    isCompactIdle: () => isCompactIdle,
    onCompactExpand: () => { compactExpanded = true; },
  });

  // Run controller effects
  $effect(() => {
    controller.setupEffects();
  });

  // Global event listeners
  $effect(() => {
    const handleBlur = () => { compactExpanded = false; };
    document.addEventListener('click', keyboard.maintainSearchFocus, true);
    window.addEventListener('keydown', keyboard.handleGlobalKeydown, true);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', keyboard.handleGlobalKeydown, true);
      document.removeEventListener('click', keyboard.maintainSearchFocus, true);
      window.removeEventListener('blur', handleBlur);
    };
  });

  // `searchExpandSticky` defers compact→expanded until the in-flight search
  // for the current query has completed, so the window doesn't grow to 560
  // while `items` still holds the previous query's results (one-paint flash).
  let searchExpandSticky = $state(false);
  const isSearchSettled = $derived(
    controller.currentError !== null
    || (!!controller.localSearchValue
        && !controller.isSearchLoadingVal
        && searchOrchestrator.lastCompletedQuery === controller.localSearchValue)
  );
  $effect(() => {
    if (!controller.localSearchValue) searchExpandSticky = false;
    else if (isSearchSettled) searchExpandSticky = true;
  });

  // `settingsService.initialized` gate: Rust seeds the window at the correct
  // geometry during setup_app (lib.rs `read_launch_view`). Without this gate,
  // a compact user's first effect run would see DEFAULT_SETTINGS.launchView
  // === 'default' and clobber Rust's 96px seed with setLauncherHeight(560).
  const isCompactIdle = $derived(
    settingsService.initialized
    && settingsService.currentSettings.appearance.launchView === 'compact'
    && !compactExpanded
    && !controller.activeViewVal
    && (!controller.localSearchValue || !searchExpandSticky)
  );

  // Mirror query presence to Rust so the resign handler can tell a real
  // typed-query expansion from a transient Show More click.
  let lastHasQuery: boolean | null = null;
  $effect(() => {
    const hasQuery = !!controller.localSearchValue;
    if (hasQuery === lastHasQuery) return;
    lastHasQuery = hasQuery;
    setLauncherHasQuery(hasQuery).catch((e) =>
      logService.debug(`[compact] setLauncherHasQuery failed: ${e}`)
    );
  });

  // Double-rAF guards two races: (1) on typing-triggered expand, lets WebKit
  // composite the new `items` into the cropped-away region before AppKit grows
  // the window, so the user never sees stale items; (2) on first hydration,
  // lets Svelte finish before we touch AppKit — a mid-hydration CATransaction
  // blanks the search header for a frame. Skip when target height unchanged
  // (effect re-runs on every keystroke via searchExpandSticky's deps).
  let pendingRaf1 = 0;
  let pendingRaf2 = 0;
  let lastApplied = -1;
  $effect(() => {
    const expand = !isCompactIdle;
    const height = isCompactIdle ? WINDOW_HEIGHT_COMPACT : WINDOW_HEIGHT_DEFAULT;
    if (height === lastApplied) return;
    lastApplied = height;
    if (pendingRaf1) { cancelAnimationFrame(pendingRaf1); pendingRaf1 = 0; }
    if (pendingRaf2) { cancelAnimationFrame(pendingRaf2); pendingRaf2 = 0; }
    pendingRaf1 = requestAnimationFrame(() => {
      pendingRaf2 = requestAnimationFrame(() => {
        pendingRaf2 = 0;
        setLauncherHeight(height, expand).catch((e) =>
          logService.debug(`[compact] setLauncherHeight failed: ${e}`)
        );
      });
      pendingRaf1 = 0;
    });
  });

  onMount(() => {
    startNativeBarStyleSync();
    const unlistens: UnlistenFn[] = [];

    listen('launcher:show-more-clicked', () => { compactExpanded = true; })
      .then((fn) => unlistens.push(fn));
    // Clear compactExpanded on hide (resign key), not on the next show: if we
    // waited for did_become_key, panel.show would paint the last 560 frame
    // before JS could shrink it. Rust also resets the window geometry in its
    // resign handler so the next show is already compact.
    listen('main_panel_did_resign_key', () => { compactExpanded = false; })
      .then((fn) => unlistens.push(fn));

    // Reveal the native Show More bar (created hidden so cold-start paint
    // latency doesn't show "bar visible, header blank"). Single rAF lines up
    // `setHidden:NO` with WebKit's first painted frame — double-rAF would be
    // a frame too late and produce the reverse glitch.
    requestAnimationFrame(() => {
      markLauncherReady(!isCompactIdle).catch((e) =>
        logService.debug(`[compact] markLauncherReady failed: ${e}`)
      );
    });

    return () => { for (const fn of unlistens) fn(); };
  });

  const extensionRecords = extensionManager.extensionRecords;
</script>

<!--
  Static 560px layout — intentionally window-height-independent. When Rust
  crops the NSWindow to 96 (compact), nothing in the tree reflows; WebKit
  presents a sub-rect of an already-composited layer. Using h-screen or any
  height-consuming flex would invalidate WebKit's layout on every resize,
  producing a 1–2 frame blank flash on first show.
-->
<div class="app-root" style="position: relative; width: 100%;">
  <div class="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)] shadow-md" style="height: 56px;">
    <SearchHeader
      bind:ref={searchInput}
      bind:value={controller.localSearchValue}
      showBack={!!controller.activeViewVal}
      searchable={!(controller.activeViewVal && !controller.activeViewSearchableVal)}
      placeholder={controller.activeViewVal ? (controller.activeViewSearchableVal ? "Search..." : "Press Escape to go back") : "Search or type a command..."}
      activeContext={controller.activeContextChip}
      bind:contextQuery={controller.contextQuery}
      contextHint={controller.contextHintChip}
      oninput={(e) => controller.handleSearchInput(e)}
      onkeydown={keyboard.handleKeydown}
      onclick={() => controller.handleBackClick()}
      oncontextDismiss={() => controller.handleChipDismiss()}
      oncontextQueryChange={(d) => controller.handleContextQueryChange(d)}
    />
  </div>

  <div class="fixed left-0 right-0 overflow-y-auto" style="top: 56px; bottom: 40px;">
    {#if controller.activeViewVal}
      <ExtensionViewContainer
        activeView={controller.activeViewVal}
        {extensionManager}
      />
    {:else}
      <SearchResultsArea
        items={controller.searchResultItemsMapped}
        selectedIndex={controller.selectedIndexVal}
        isSearchLoading={controller.isSearchLoadingVal}
        currentError={controller.currentError}
        localSearchValue={controller.localSearchValue}
        bind:listContainer
        onselect={(detail) => {
          if (isCompactIdle) return;
          const clickedIndex = controller.searchResultItemsMapped.findIndex(item => item.object_id === detail.item.object_id);
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
      onclose={() => { isActionPanelOpen = false; if (!controller.assignShortcutTarget) keyboard.restoreSearchFocus(); }} 
    />
  {/if}

  <BottomActionBar
    bind:this={bottomActionBarInstance}
    selectedItem={controller.currentSelectedItemOriginal}
    errorState={controller.currentError}
    isActionListOpen={isActionPanelOpen}
    {isCompactIdle}
    onactionListToggled={() => { actionService.refreshFiltered(); isActionPanelOpen = !isActionPanelOpen }}
    onactionListClosed={() => { isActionPanelOpen = false; if (!controller.assignShortcutTarget) keyboard.restoreSearchFocus(); }}
    onexpand={() => { compactExpanded = true; }}
  />
  
  {#if controller.assignShortcutTarget}
    <ShortcutCaptureOverlay
      target={controller.assignShortcutTarget}
      oncapture={() => { controller.assignShortcutTarget = null; keyboard.restoreSearchFocus(); }}
      oncancel={() => { controller.assignShortcutTarget = null; keyboard.restoreSearchFocus(); }}
    />
  {/if}

  <ToastHost />
  <DialogHost />

  {#if whatsNewStore.version}
    <WhatsNewPanel
      version={whatsNewStore.version}
      onDismiss={async () => {
        const v = whatsNewStore.version!;
        await settingsService.updateSettings('updates', { lastSeenVersion: v });
        whatsNewStore.version = null;
      }}
    />
  {/if}

  {#if shellConsentService.activeRequest}
    {@const request = shellConsentService.activeRequest}
    {@const manifest = extensionManager.getManifestById(request.extensionId)}
    <ShellConsentDialog
      extensionName={manifest?.name ?? request.extensionId}
      extensionIcon={manifest?.icon ? `asyar-icon://${request.extensionId}/${manifest.icon}` : undefined}
      program={request.program}
      resolvedPath={request.resolvedPath}
      onAllow={() => shellConsentService.approveCurrent()}
      onDeny={() => shellConsentService.denyCurrent()}
    />
  {/if}
</div>

<BackgroundExtensionIframes extensions={extensionRecords.filter(e => e.enabled)} />

<style global>
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(155, 155, 155, 0.5)); border-radius: var(--radius-md); }
</style>
