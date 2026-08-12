<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    description = '',
    children,
  }: {
    label: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<div class="settings-row">
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
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-7);
    padding: var(--space-5-5) var(--space-6);
  }

  /* Inset 16px from the left, flush right, never after the last row —
     a border on the row itself would be flush on both sides, so the
     divider is a positioned pseudo-element instead. */
  .settings-row:not(:last-child)::after {
    content: '';
    position: absolute;
    left: var(--space-6);
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--border-color);
  }

  .settings-row-text {
    flex: 1;
    min-width: 0;
  }

  .settings-row-label {
    font-size: var(--font-size-md);
    font-weight: 500;
    color: var(--text-primary);
  }

  .settings-row-description {
    margin-top: var(--space-1);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .settings-row-control {
    flex-shrink: 0;
  }
</style>
