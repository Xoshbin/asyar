<script lang="ts">
  import ResultsList from '../list/ResultsList.svelte';
  import EmptyState from '../feedback/EmptyState.svelte';
  import { ErrorState } from '../index';
  import { logService } from '../../services/log/logService';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';

  const SEARCH_FATAL_KINDS = new Set([
    'search_lock_poisoned',
    'search_io_failure',
    'search_other',
  ]);

  interface Props {
    items: any[];
    selectedIndex: number;
    isSearchLoading: boolean;
    localSearchValue: string;
    listContainer?: HTMLDivElement;
    onselect: (detail: { item: any }) => void;
  }

  let {
    items,
    selectedIndex,
    isSearchLoading,
    localSearchValue,
    listContainer = $bindable(),
    onselect,
  }: Props = $props();
</script>

<div class="min-h-full flex flex-col">
  <div bind:this={listContainer}>
    {#if diagnosticsService.current && SEARCH_FATAL_KINDS.has(diagnosticsService.current.kind)}
      <ErrorState status={diagnosticsService.current} />
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
