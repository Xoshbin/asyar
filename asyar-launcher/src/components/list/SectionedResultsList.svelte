<script lang="ts">
  import CalcResultCard from './CalcResultCard.svelte';
  import LauncherListRow from './LauncherListRow.svelte';
  import { statusForRow } from '../../services/launcher/itemStatusLogic';

  import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';
  import { buildSectionedView } from './sectionedListLogic';

  let {
    items = [],
    selectedIndex = -1,
    onselect,
  }: {
    items?: MappedSearchItem[];
    selectedIndex?: number;
    onselect?: (detail: { item: MappedSearchItem }) => void;
  } = $props();

  const rows = $derived(buildSectionedView(items));
</script>

<div class="p-2">
  {#each rows as row}
    {#if row.kind === 'header'}
      <div class="section-header">{row.title}</div>
    {:else if row.item.style === 'large'}
      <CalcResultCard
        item={row.item}
        index={row.originalIndex}
        selected={row.originalIndex === selectedIndex}
        onclick={() => onselect?.({ item: row.item })}
      />
    {:else}
      {@const status = statusForRow(row.item)}
      <LauncherListRow
        data-index={row.originalIndex}
        selected={row.originalIndex === selectedIndex}
        onclick={() => onselect?.({ item: row.item })}
        icon={row.item.icon}
        title={row.item.title}
        subtitle={row.item.subtitle}
        alias={row.item.alias}
        shortcut={row.item.shortcut}
        typeLabel={row.item.typeLabel}
        {status}
      />
    {/if}
  {/each}
</div>
