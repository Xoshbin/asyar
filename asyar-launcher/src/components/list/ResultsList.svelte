<script lang="ts">
  import CalcResultCard from './CalcResultCard.svelte';
  import LauncherListRow from './LauncherListRow.svelte';
  import { statusForRow } from '../../services/launcher/itemStatusLogic';

  import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';

  type Item = MappedSearchItem;

  let {
    items = [],
    selectedIndex = -1,
    onselect,
  }: {
    items?: Item[];
    selectedIndex?: number;
    onselect?: (detail: { item: Item }) => void;
  } = $props();
</script>

<div class="p-2">
  {#each items as item, i}
    {#if item.style === 'large'}
      <CalcResultCard
        {item}
        index={i}
        selected={i === selectedIndex}
        onclick={() => onselect?.({ item })}
      />
    {:else}
      {@const status = statusForRow(item)}
      <LauncherListRow
        data-index={i}
        selected={i === selectedIndex}
        onclick={() => onselect?.({ item })}
        icon={item.icon}
        title={item.title}
        subtitle={item.subtitle}
        alias={item.alias}
        shortcut={item.shortcut}
        typeLabel={item.typeLabel}
        {status}
      />
    {/if}
  {/each}
</div>
