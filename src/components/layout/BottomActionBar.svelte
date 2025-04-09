<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { logService } from '../../services/log/logService';
  import { actionStore } from '../../services/action/actionService';
  import type { ApplicationAction } from '../../services/action/actionService';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-api';
  import { isSearchLoading, activeViewPrimaryActionLabel } from '../../services/ui/uiStateStore'; // Import new store
  import extensionManager from '../../services/extension/extensionManager'; // Import instance
  import { activeView } from '../../services/extension/extensionManager'; // Import store

  // Import child components
  import InformationPanel from './InformationPanel.svelte';
  import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
  import ActionListPopup from './ActionListPopup.svelte';

  // Props from parent (+page.svelte)
  export let selectedItem: SearchResult | null = null;
  // Removed activeViewInfo prop, will derive manifest reactively
  // export let activeViewInfo: { name: string; manifest?: ExtensionManifest } | null = null;
  // export let isLoading: boolean = false; // Replaced by isSearchLoading store
  export let errorState: string | null = null; // Prop for potential errors

  // Internal State
  let isActionListOpen = false;
  let availableActions: ApplicationAction[] = [];
  let currentActiveViewManifest: ExtensionManifest | null = null;

  // Subscribe to action store
  const unsubscribeActions = actionStore.subscribe(actions => {
    availableActions = actions;
    // Optional: If actions change while popup is open, maybe close it or reset index?
    // if (isActionListOpen) selectedActionIndex = 0;
  });

  // Subscribe to activeView to get the manifest
  const unsubscribeActiveView = activeView.subscribe((viewId) => {
    if (viewId) {
      // Use the newly added public method
      currentActiveViewManifest = extensionManager.getManifestById(viewId.split('/')[0]) ?? null;
      logService.debug(`[BottomActionBar] Active view changed, got manifest for ${currentActiveViewManifest?.name}`);
    } else {
      currentActiveViewManifest = null;
      logService.debug(`[BottomActionBar] Active view cleared.`);
    }
  });


  // --- Component Logic ---

  // Exported function to toggle the action list popup
  export function toggleActionList() {
    isActionListOpen = !isActionListOpen;
    logService.debug(`[BottomActionBar] Action list toggled: ${isActionListOpen ? 'Open' : 'Closed'}`);
    if (isActionListOpen) {
        // Focus management will be handled within ActionListPopup onMount
    } else {
        // Focus restoration to search input should happen in the parent (+page.svelte)
        // after the popup closes. We might need a small delay or event.
    }
  }

  function handlePopupClose() {
    isActionListOpen = false;
    logService.debug(`[BottomActionBar] Action list closed via event.`);
    // Potentially dispatch an event here if parent needs to know for focus restoration
  }

  // --- Lifecycle ---
  onDestroy(() => {
    unsubscribeActions();
    unsubscribeActiveView();
  });

</script>

<!-- Main Bottom Bar Container -->
<div class="fixed bottom-0 left-0 right-0 z-40 h-10 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between px-1 shadow-inner">

  <!-- Left Side: Information Panel -->
  <div class="flex-1 min-w-0">
    <InformationPanel {selectedItem} activeViewManifest={currentActiveViewManifest} />
  </div>

  <!-- Center/Right Side: Loading/Error/Actions/Primary -->
  <div class="flex items-center gap-3 flex-shrink-0">

    {#if $isSearchLoading}
      <!-- Loading Indicator -->
      <div class="text-xs text-[var(--text-secondary)] px-2 animate-pulse">Loading...</div>
    {:else if errorState}
      <!-- Error Indicator -->
      <div class="text-xs text-red-500 px-2 truncate max-w-xs" title={errorState}>Error: {errorState}</div>
    {/if}

    <!-- Primary Action Display (Moved Before Action Trigger) -->
    <PrimaryActionDisplay {selectedItem} activeViewLabel={$activeViewPrimaryActionLabel} />

    <!-- Action Trigger Button (Moved After Primary Action) -->
    <button
      on:click={toggleActionList}
      class="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] mr-2"
      aria-haspopup="true"
      aria-expanded={isActionListOpen}
    >
      <span>Actions</span>
      <span class="text-[var(--text-tertiary)]">⌘ K</span>
    </button>

  </div>

  <!-- Action List Popup (Conditionally Rendered) -->
  {#if isActionListOpen}
    <ActionListPopup {availableActions} on:close={handlePopupClose} />
  {/if}

</div>

<style>
  /* Add any specific styles for the bottom bar itself if needed */
</style>
