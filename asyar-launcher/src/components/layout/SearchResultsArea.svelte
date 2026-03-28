<script lang="ts">
  import { ResultsList } from '../../components';
  import { logService } from '../../services/log/logService';

  interface Props {
    items: any[];
    selectedIndex: number;
    isSearchLoading: boolean;
    currentError: string | null;
    localSearchValue: string;
    listContainer?: HTMLDivElement;
    onselect: (detail: { item: any }) => void;
  }

  let {
    items,
    selectedIndex,
    isSearchLoading,
    currentError,
    localSearchValue,
    listContainer = $bindable(),
    onselect,
  }: Props = $props();
</script>

<div class="min-h-full flex flex-col">
  <div bind:this={listContainer}>
    {#if isSearchLoading}
      <div class="p-4 text-center text-[var(--text-secondary)]">Loading...</div>
    {:else if currentError}
      <div class="p-4 text-center text-red-500">{currentError}</div>
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
    {:else if localSearchValue}
      <div class="p-4 text-center text-[var(--text-secondary)]">No results found.</div>
    {/if}
  </div>
</div>
