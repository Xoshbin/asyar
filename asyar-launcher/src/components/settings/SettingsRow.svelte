<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    description = '',
    noBorder = false,
    children,
  }: {
    label: string;
    description?: string;
    noBorder?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="settings-row" class:no-border={noBorder}>
  <div class="settings-row-text">
    <div class="settings-row-label">{label}</div>
    {#if description}
      <div class="settings-row-description">{description}</div>
    {/if}
  </div>
  <div class="settings-row-control">
    {@render children()}
  </div>
</div>

<style>
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-6) 0;
    border-bottom: 1px solid var(--border-color);
    gap: var(--space-6);
  }

  .settings-row.no-border {
    border-bottom: none;
  }

  .settings-row-text {
    flex: 1;
    min-width: 0;
  }

  .settings-row-label {
    font-weight: 500;
    color: var(--text-primary);
    font-size: var(--font-size-base);
  }

  .settings-row-description {
    margin-top: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .settings-row-control {
    flex-shrink: 0;
  }
</style>
