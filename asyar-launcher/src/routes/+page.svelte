<script lang="ts">
  import { onMount } from 'svelte';
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
  import extensionManager from '../services/extension/extensionManager.svelte';
  import { settingsService } from '../services/settings/settingsService.svelte';
  import { setLauncherHeight } from '../lib/ipc/commands';
  import { shellConsentService } from '../services/shell/shellConsentService.svelte';
  import ShellConsentDialog from '../components/shell/ShellConsentDialog.svelte';
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

  // Compact launch view: hide results and shrink window when idle
  const isCompactIdle = $derived(
    settingsService.currentSettings.appearance.launchView === 'compact'
    && !compactExpanded
    && !controller.localSearchValue
    && !controller.activeViewVal
  );

  $effect(() => {
    const height = isCompactIdle ? WINDOW_HEIGHT_COMPACT : WINDOW_HEIGHT_DEFAULT;
    setLauncherHeight(height).catch((e) => console.warn('[compact] setLauncherHeight failed:', e));
  });

  const extensionRecords = extensionManager.extensionRecords;
</script>

<div class="app-root flex flex-col h-screen">
  <div class="fixed top-0 left-0 right-0 z-[100] bg-[var(--bg-primary)] shadow-md">
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
  
  <div class="h-[56px] flex-shrink-0"></div>
  
  <div class="flex-1 min-h-0 overflow-hidden flex flex-row">
    <div class="flex-1 flex flex-col min-w-0 h-full relative">
      <div class="flex-1 overflow-y-auto pb-10">
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
            {isCompactIdle}
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
    </div>
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
    onactionListToggled={() => { isActionPanelOpen = !isActionPanelOpen }}
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
