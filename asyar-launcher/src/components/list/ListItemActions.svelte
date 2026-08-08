<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
  }: {
    children: Snippet;
  } = $props();
</script>

<div class="list-item-actions">
  {@render children()}
</div>

<style>
  .list-item-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  :global(.list-row.selected) .list-item-actions {
    opacity: 1;
  }
</style>
