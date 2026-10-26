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
      <div class="section-header root-section">{row.title}</div>
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

<style>
  /* Sits on the same 16px left edge as the row icons and the query. The
     shared .section-header indents 24px, which reads as a stray step. */
  .root-section {
    padding: var(--space-4) var(--space-3) var(--space-1);
    /* A quiet sentence-case label rather than the shared uppercase one: the
       root list is read at a glance, and caps-plus-tracking shouts over the
       rows it introduces. */
    font-size: var(--font-size-sm);
    font-weight: 500;
    text-transform: none;
    letter-spacing: var(--tracking-normal);
    color: var(--text-secondary);
  }

  /* The search field already gives the list its breathing room above. */
  .root-section:first-child {
    padding-top: 0;
  }
</style>
