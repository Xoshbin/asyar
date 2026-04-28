<script lang="ts">
  import { onMount } from 'svelte';
  import { LauncherController } from '../lib/launcher/launcherController.svelte';
  import ExtensionViewContainer from '../components/extension/ExtensionViewContainer.svelte';
  import WorkerIframes from '../components/extension/WorkerIframes.svelte';
  import SearchResultsArea from '../components/layout/SearchResultsArea.svelte';
  import ShortcutCaptureOverlay from '../components/layout/ShortcutCaptureOverlay.svelte';
  import SearchHeader from '../components/layout/SearchHeader.svelte';
  import BottomActionBar from '../components/layout/BottomActionBar.svelte';
  import ActionListPopup from '../components/layout/ActionListPopup.svelte';
  import ToastHost from '../components/feedback/ToastHost.svelte';
  import DialogHost from '../components/feedback/DialogHost.svelte';
  import FatalErrorDialog from '../components/feedback/FatalErrorDialog.svelte';
  import { createKeyboardHandlers } from '../lib/keyboard/launcherKeyboard';
  import { searchStores } from '../services/search/stores/search.svelte';
  import { searchService } from '../services/search/SearchService';
  import { searchOrchestrator } from '../services/search/searchOrchestrator.svelte';
  import extensionManager from '../services/extension/extensionManager.svelte';
  import { settingsService } from '../services/settings/settingsService.svelte';
  import { CompactSyncService } from '../services/launcher/compactSyncService.svelte';
  import { diagnosticsService } from '../services/diagnostics/diagnosticsService.svelte';
  import { logService } from '../services/log/logService';
  import { shellConsentService } from '../services/shell/shellConsentService.svelte';
  import ShellConsentDialog from '../components/shell/ShellConsentDialog.svelte';
  import { actionService } from '../services/action/actionService.svelte';
  import { commandArgumentsService } from '../services/search/commandArguments';
  import WhatsNewPanel from '../components/feedback/WhatsNewPanel.svelte';
  import { whatsNewStore } from '../services/update/whatsNewStore.svelte';
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
  let accessoryRef = $state<{ focus: () => void; openPopover: () => void; togglePopover: () => void } | null>(null);

  // Compact launch-view synchronization — owns compactExpanded, sticky gate,
  // query-mirror and setLauncherHeight scheduling. See compactSyncService.
  const compactSync = new CompactSyncService({
    getInitialized: () => settingsService.initialized,
    getLaunchView: () => settingsService.currentSettings.appearance.launchView,
    getActiveView: () => controller.activeViewVal,
    getActiveContext: () => controller.activeContext,
    getLocalSearchValue: () => controller.localSearchValue,
    getIsSearchLoading: () => controller.isSearchLoadingVal,
    getCurrentDiagnosticSeverity: () => diagnosticsService.current?.severity ?? null,
    getLastCompletedQuery: () => searchOrchestrator.lastCompletedQuery,
  });
  const isCompactIdle = $derived(compactSync.isCompactIdle);

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
    onCompactExpand: () => { compactSync.compactExpanded = true; },
  });

  function handleActionPanelClose() {
    isActionPanelOpen = false;
    if (!controller.assignShortcutTarget) keyboard.restoreSearchFocus({ select: true });
  }

  // Run controller effects
  $effect(() => {
    controller.setupEffects();
  });

  // Global event listeners
  $effect(() => {
    const handleBlur = () => { compactSync.compactExpanded = false; };
    document.addEventListener('click', keyboard.maintainSearchFocus, true);
    window.addEventListener('keydown', keyboard.handleGlobalKeydown, true);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', keyboard.handleGlobalKeydown, true);
      document.removeEventListener('click', keyboard.maintainSearchFocus, true);
      window.removeEventListener('blur', handleBlur);
    };
  });

  // Compact-sync reactive drivers — each effect is a thin call into the
  // service so the dependencies (controller.*, searchOrchestrator.*,
  // settingsService.*) are tracked by Svelte's reactivity graph.
  $effect(() => { compactSync.updateSearchExpandSticky(); });
  $effect(() => { compactSync.syncKeepExpanded(); });
  $effect(() => { compactSync.applyLauncherHeight(); });

  onMount(() => compactSync.onMount());

  // Argument-mode derived state. Svelte 5 runes in the service propagate
  // through this $derived into the SearchHeader props.
  const argumentMode = $derived(commandArgumentsService.active);
  const argumentCanSubmit = $derived(commandArgumentsService.canSubmit());

  async function handleArgSubmit() {
    try {
      await commandArgumentsService.submit();
    } catch (err) {
      // Submission errors (execute threw) are also logged by the service;
      // surface a user-visible diagnostic and keep argument mode open so
      // the user can retry or Esc out.
      logService.error(`[argumentMode] submit failed: ${err}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'action_failed', severity: 'error',
        retryable: false,
        context: { message: 'Could not run command with the provided arguments' },
      });
    }
  }
</script>

<!--
  Static 560px layout — intentionally window-height-independent. When Rust
  crops the NSWindow to 96 (compact), nothing in the tree reflows; WebKit
  presents a sub-rect of an already-composited layer. Using h-screen or any
  height-consuming flex would invalidate WebKit's layout on every resize,
  producing a 1–2 frame blank flash on first show.
-->
<div class="app-root" style="position: relative; width: 100%;">
  <div class="fixed top-0 left-0 right-0 z-[100]" style="height: 56px;">
    <SearchHeader
      bind:ref={searchInput}
      bind:accessoryRef
      bind:value={controller.localSearchValue}
      showBack={!!controller.activeViewVal}
      searchable={!(controller.activeViewVal && !controller.activeViewSearchableVal)}
      placeholder={controller.activeViewVal ? (controller.activeViewSearchableVal ? "Search..." : "Press Escape to go back") : "Search or type a command..."}
      activeContext={controller.activeContextChip}
      activeViewId={controller.activeViewVal}
      bind:contextQuery={controller.contextQuery}
      contextHint={controller.contextHintChip}
      argumentMode={argumentMode}
      argumentCanSubmit={argumentCanSubmit}
      oninput={(e) => controller.handleSearchInput(e)}
      onkeydown={keyboard.handleKeydown}
      onclick={() => controller.handleBackClick()}
      oncontextDismiss={() => controller.handleChipDismiss()}
      oncontextQueryChange={(d) => controller.handleContextQueryChange(d)}
      onArgValueChange={(name, v) => commandArgumentsService.setValue(name, v)}
      onArgFocusField={(idx) => commandArgumentsService.focusField(idx)}
      onArgNext={() => commandArgumentsService.next()}
      onArgPrev={() => commandArgumentsService.prev()}
      onArgSubmit={handleArgSubmit}
      onArgExit={() => commandArgumentsService.exit()}
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
      onclose={handleActionPanelClose}
    />
  {/if}

  <BottomActionBar
    bind:this={bottomActionBarInstance}
    selectedItem={controller.currentSelectedItemOriginal}
    isActionListOpen={isActionPanelOpen}
    {isCompactIdle}
    onactionListToggled={() => { actionService.refreshFiltered(); isActionPanelOpen = !isActionPanelOpen }}
    onactionListClosed={handleActionPanelClose}
    onexpand={() => { compactSync.compactExpanded = true; }}
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
  <FatalErrorDialog />

  {#if import.meta.env.DEV}
    {#await import('../components/dev/InspectorShell.svelte') then InspectorShellModule}
      <InspectorShellModule.default />
    {/await}
  {/if}

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

<WorkerIframes />

<style global>
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(155, 155, 155, 0.5)); border-radius: var(--radius-md); }
</style>
