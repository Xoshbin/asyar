<script lang="ts">
  import { actionService, type ApplicationAction } from '../../services/action/actionService.svelte';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-sdk';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import InformationPanel from './InformationPanel.svelte';
  import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
  import BottomBarButton from './BottomBarButton.svelte';

  let {
    selectedItem = null,
    errorState = null,
    isActionListOpen = false,
    isCompactIdle = false,
    onactionListToggled,
    onactionListClosed,
    onexpand,
  }: {
    selectedItem?: SearchResult | null;
    errorState?: string | null;
    isActionListOpen: boolean;
    isCompactIdle?: boolean;
    onactionListToggled: () => void;
    onactionListClosed: () => void;
    onexpand?: () => void;
  } = $props();

  let availableActions = $derived(actionService.filteredActions);
  
  let currentActiveViewManifest = $derived(viewManager.activeView 
    ? (extensionManager.getManifestById(viewManager.activeView.split('/')[0]) ?? null)
    : null
  );

  let enrichedActionsInternal = $derived(availableActions.map(action => ({
    ...action,
    displayCategory: action.category
      ?? (action.extensionId ? (extensionManager.getManifestById(action.extensionId)?.name ?? action.extensionId) : null)
      ?? 'Actions'
  })));

  export function getEnrichedActions() {
    return enrichedActionsInternal;
  }

  // Legacy compat functions for LauncherController
  export function toggleActionList() { onactionListToggled(); }
  export function closeActionList() { if (isActionListOpen) onactionListClosed(); }
  export function isOpen(): boolean { return isActionListOpen; }

  function handleActionClick() {
    onactionListToggled();
  }
</script>

<div class="fixed bottom-0 left-0 right-0 z-40 h-10 border-t border-[var(--border-color)] flex items-center justify-between px-3 shadow-inner" style="background-color: var(--bg-secondary-full-opacity);">
  {#if isCompactIdle}
    <div class="flex-1"></div>
    <BottomBarButton
      label="Show More"
      keyHint="↓"
      onclick={() => onexpand?.()}
      class="mr-2"
    />
  {:else}
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

      <BottomBarButton
        label="Actions"
        keyHint={["⌘", "K"]}
        onclick={handleActionClick}
        ariaHaspopup="true"
        ariaExpanded={isActionListOpen}
        class="mr-2"
      />
    </div>
  {/if}
</div>

