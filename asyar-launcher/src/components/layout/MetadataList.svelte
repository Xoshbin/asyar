<script lang="ts" module>
  /** Raycast-style label/value metadata block for a detail pane's selected
   * item. Compact and fixed-height so the preview above keeps every
   * remaining pixel. Rows with an empty value are skipped. */
  export interface MetadataItem {
    label: string;
    value: string | null | undefined;
    /** Hover text, e.g. the full path behind a shortened value. */
    title?: string;
    /** Optional image URL or icon source shown next to value. */
    icon?: string;
    /** Optional monospace font for paths, hashes, or sizes. */
    mono?: boolean;
  }
</script>

<script lang="ts">
  import AppIcon from '../base/AppIcon.svelte';
  let {
    items,
    title,
  }: {
    items: MetadataItem[];
    title?: string;
  } = $props();

  const visibleItems = $derived(
    items.filter((item) => item.value !== null && item.value !== undefined && item.value !== ''),
  );
</script>

{#if visibleItems.length > 0}
  <div class="metadata-section">
    {#if title}
      <div class="metadata-header">{title}</div>
    {/if}
    <dl class="metadata-list">
      {#each visibleItems as item, index (item.label)}
        <div class="metadata-row" class:striped={index % 2 === 0}>
          <dt>{item.label}</dt>
          <dd title={item.title ?? item.value} class:mono={item.mono}>
            {#if item.icon}
              <AppIcon icon={item.icon} size={16} />
            {/if}
            <span class="metadata-value-text">{item.value}</span>
          </dd>
        </div>
      {/each}
    </dl>
  </div>
{/if}

<style>
  .metadata-section {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-sm);
  }

  .metadata-header {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 500;
    padding: 0 var(--space-2);
    margin-bottom: var(--space-1);
    letter-spacing: var(--tracking-normal);
  }

  .metadata-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: 0;
    padding: 0;
  }

  .metadata-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    min-height: var(--size-lg);
    border-radius: var(--radius-sm);
  }

  .metadata-row.striped {
    background: var(--bg-tertiary);
  }

  dt {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  dd {
    margin: 0;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    min-width: 0;
    text-align: right;
  }

  dd.mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .metadata-value-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
