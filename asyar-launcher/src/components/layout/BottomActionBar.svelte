<script lang="ts">
  import { logService } from '../../services/log/logService';
  import { actionStore } from '../../services/action/actionService';
  import type { ApplicationAction } from '../../services/action/actionService';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import type { ExtensionManifest } from 'asyar-sdk';
  import { activeViewPrimaryActionLabel } from '../../services/extension/viewManager';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import extensionManager, { activeView } from '../../services/extension/extensionManager';
  import InformationPanel from './InformationPanel.svelte';
  import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
  import ActionListPopup from './ActionListPopup.svelte';

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
  let availableActions = $state<ApplicationAction[]>([]);
  let currentActiveViewManifest = $state<ExtensionManifest | null>(null);

  $effect(() => {
    const unsub1 = actionStore.subscribe(actions => {
      availableActions = actions;
    });
    const unsub2 = activeView.subscribe((viewId) => {
      if (viewId) {
        currentActiveViewManifest = extensionManager.getManifestById(viewId.split('/')[0]) ?? null;
      } else {
        currentActiveViewManifest = null;
      }
    });
    return () => {
      unsub1();
      unsub2();
    };
  });

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

<div class="fixed bottom-0 left-0 right-0 z-40 h-10 border-t border-[var(--border-color)] flex items-center justify-between px-1 shadow-inner" style="background-color: var(--bg-secondary-full-opacity);">
  <div class="flex-1 min-w-0">
    <InformationPanel {selectedItem} activeViewManifest={currentActiveViewManifest} />
  </div>

  <div class="flex items-center gap-3 flex-shrink-0">
    {#if searchStores.isLoading}
      <div class="text-xs text-[var(--text-secondary)] px-2 animate-pulse">Loading...</div>
    {:else if errorState}
      <div class="text-xs text-red-500 px-2 truncate max-w-xs" title={errorState}>Error: {errorState}</div>
    {/if}

    <PrimaryActionDisplay {selectedItem} activeViewLabel={$activeViewPrimaryActionLabel} />

    <button
      onclick={toggleActionList}
      class="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border-color)] rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] mr-2"
      aria-haspopup="true"
      aria-expanded={isActionListOpen}
    >
      <span>Actions</span>
      <span class="text-[var(--text-secondary)]">⌘ K</span>
    </button>
  </div>

  {#if isActionListOpen}
    <ActionListPopup availableActions={enrichedActions} onclose={handlePopupClose} />
  {/if}
</div>
