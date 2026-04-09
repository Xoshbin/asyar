<script lang="ts">
  import { ResultsList, EmptyState } from '../../components';
  import { logService } from '../../services/log/logService';

  interface Props {
    items: any[];
    selectedIndex: number;
    isSearchLoading: boolean;
    currentError: string | null;
    localSearchValue: string;
    isCompactIdle?: boolean;
    listContainer?: HTMLDivElement;
    onselect: (detail: { item: any }) => void;
  }

  let {
    items,
    selectedIndex,
    isSearchLoading,
    currentError,
    localSearchValue,
    isCompactIdle = false,
    listContainer = $bindable(),
    onselect,
  }: Props = $props();
</script>

<div class="min-h-full flex flex-col">
  <div bind:this={listContainer} class="pt-3">
    {#if currentError}
      <EmptyState message={currentError}>
        {#snippet icon()}
          <span style="color: var(--accent-danger); font-size: var(--font-size-3xl);">⚠️</span>
        {/snippet}
      </EmptyState>
    {:else if isCompactIdle}
      <!-- Compact launch view: show nothing until user types -->
    {:else if items.length > 0}
      <ResultsList
        {items}
        {selectedIndex}
        onselect={(detail) => {
          const clickedIndex = items.findIndex(item => item.object_id === detail.item.object_id);
          if (clickedIndex !== -1) {
            onselect({ item: detail.item });
          } else {
            logService.warn(`Clicked item not found in current results: ${detail.item?.object_id ?? 'Unknown'}`);
          }
        }}
      />
    {:else if localSearchValue && !isSearchLoading}
      <EmptyState message="No results found." />
    {/if}
  </div>
</div>
