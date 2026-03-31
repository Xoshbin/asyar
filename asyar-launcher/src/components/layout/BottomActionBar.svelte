<script lang="ts">
  import { actionService, type ApplicationAction } from '../../services/action/actionService.svelte';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-sdk';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import InformationPanel from './InformationPanel.svelte';
  import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
  import ActionListPopup from './ActionListPopup.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';

  let {
    selectedItem = null,
    errorState = null,
    onactionListClosed
  }: {
    selectedItem?: SearchResult | null;
    errorState?: string | null;
    onactionListClosed?: () => void;
  } = $props();

  let isActionListOpen = $state(false);

  // Derived state from services
  let availableActions = $derived(actionService.filteredActions);
  let currentActiveViewManifest = $derived(viewManager.activeView 
    ? (extensionManager.getManifestById(viewManager.activeView.split('/')[0]) ?? null)
    : null
  );

  let enrichedActions = $derived(availableActions.map(action => ({
    ...action,
    displayCategory: action.category
      ?? (action.extensionId ? (extensionManager.getManifestById(action.extensionId)?.name ?? action.extensionId) : null)
      ?? 'Actions'
  })));

  export function toggleActionList() {
    const wasOpen = isActionListOpen;
    isActionListOpen = !isActionListOpen;
    if (wasOpen && !isActionListOpen) {
      onactionListClosed?.();
    }
  }

  export function closeActionList() {
    if (isActionListOpen) {
      isActionListOpen = false;
      onactionListClosed?.();
    }
  }

  export function isOpen(): boolean {
    return isActionListOpen;
  }

  function handlePopupClose() {
    isActionListOpen = false;
    onactionListClosed?.();
  }
</script>

<div class="fixed bottom-0 left-0 right-0 z-40 h-10 border-t border-[var(--border-color)] flex items-center justify-between px-3 shadow-inner" style="background-color: var(--bg-secondary-full-opacity);">
  <div class="flex-1 min-w-0">
    <InformationPanel {selectedItem} activeViewManifest={currentActiveViewManifest} />
  </div>

  <div class="flex items-center gap-3 flex-shrink-0">
    {#if searchStores.isLoading}
      <div class="text-xs text-[var(--text-secondary)] px-2 animate-pulse">Loading...</div>
    {:else if errorState}
      <div class="text-xs px-2 truncate max-w-xs" style="color: var(--accent-danger)" title={errorState}>Error: {errorState}</div>
    {/if}

    <PrimaryActionDisplay {selectedItem} activeViewLabel={viewManager.activeViewPrimaryActionLabel} />

    <button
      onclick={toggleActionList}
      class="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-[var(--border-color)] rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] mr-2"
      aria-haspopup="true"
      aria-expanded={isActionListOpen}
    >
      <span>Actions</span>
      <KeyboardHint keys="⌘K" />
    </button>
  </div>

  {#if isActionListOpen}
    <ActionListPopup availableActions={enrichedActions} onclose={handlePopupClose} />
  {/if}
</div>

<style>
  /* Local styles if needed */
</style>
