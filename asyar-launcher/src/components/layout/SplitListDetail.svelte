<script lang="ts">
  import type { Snippet } from 'svelte';
  import SplitView from '../list/SplitView.svelte';
  import EmptyState from '../feedback/EmptyState.svelte';
  import LoadingState from '../feedback/LoadingState.svelte';

  let {
    items,
    selectedIndex = -1,
    leftWidth = 280,
    minLeftWidth = 200,
    maxLeftWidth = 600,
    ariaLabel = 'Items',
    isLoading = false,
    loadingMessage = 'Loading...',
    error = undefined,
    emptyMessage = 'No items found',
    listItem,
    detail,
  }: {
    items: any[];
    selectedIndex?: number;
    leftWidth?: number;
    minLeftWidth?: number;
    maxLeftWidth?: number;
    ariaLabel?: string;
    isLoading?: boolean;
    loadingMessage?: string;
    error?: string | null;
    emptyMessage?: string;
    listItem: Snippet<[item: any, index: number]>;
    detail: Snippet;
  } = $props();

  let listContainer = $state<HTMLDivElement>();

  function ensureSelectedVisible() {
    requestAnimationFrame(() => {
      if (!listContainer) return;
      const element = listContainer.querySelector(`[data-index="${selectedIndex}"]`);
      if (!element) return;
      const containerRect = listContainer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      if (elementRect.top < containerRect.top) {
        element.scrollIntoView({ block: 'start', behavior: 'auto' });
      } else if (elementRect.bottom > containerRect.bottom) {
        element.scrollIntoView({ block: 'end', behavior: 'auto' });
      }
    });
  }

  $effect(() => {
    if (selectedIndex >= 0 && !isLoading && !error) {
      ensureSelectedVisible();
    }
  });
</script>

<SplitView {leftWidth} {minLeftWidth} {maxLeftWidth}>
  {#snippet left()}
    <div
      bind:this={listContainer}
      class="list-panel custom-scrollbar"
      role="listbox"
      aria-label={ariaLabel}
      tabindex="0"
    >
      {#if isLoading}
        <LoadingState message={loadingMessage} />
      {:else if error}
        <EmptyState message="Error loading items" description={error} />
      {:else if items.length === 0}
        <EmptyState message={emptyMessage} />
      {:else}
        {#each items as item, index (item.id)}
          {@render listItem(item, index)}
        {/each}
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    <div class="detail-panel">
      {@render detail()}
    </div>
  {/snippet}
</SplitView>

<style>
  .list-panel {
    height: 100%;
    overflow-y: auto;
    padding: 8px;
  }
  .list-panel:focus { outline: none; }

  .detail-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
</style>
