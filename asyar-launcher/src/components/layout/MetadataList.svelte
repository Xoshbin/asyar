<script lang="ts" module>
  /** Raycast-style label/value metadata block for a detail pane's selected
   * item. Compact and fixed-height so the preview above keeps every
   * remaining pixel. Rows with an empty value are skipped. */
  export interface MetadataItem {
    label: string;
    value: string | null | undefined;
    /** Hover text, e.g. the full path behind a shortened value. */
    title?: string;
  }
</script>

<script lang="ts">
  let { items }: { items: MetadataItem[] } = $props();
</script>

<dl class="metadata-list">
  {#each items as item (item.label)}
    {#if item.value}
      <dt>{item.label}</dt>
      <dd title={item.title ?? item.value}>{item.value}</dd>
    {/if}
  {/each}
</dl>

<style>
  .metadata-list {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: var(--space-4);
    row-gap: var(--space-1);
    margin: 0;
    padding: var(--space-3) var(--space-6);
    border-top: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
  }

  dt {
    color: var(--text-secondary);
  }

  dd {
    margin: 0;
    color: var(--text-primary);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
