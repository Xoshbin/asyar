<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    actions,
  }: {
    children: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<div class="warning-banner">
  <div class="banner-icon">⚠️</div>
  <div class="banner-content">
    {@render children()}
    {#if actions}
      <div class="banner-actions">
        {@render actions()}
      </div>
    {/if}
  </div>
</div>

<style>
  .warning-banner {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
    border: 1px solid var(--accent-warning);
    border-radius: var(--radius-md);
    align-items: flex-start;
  }

  .banner-icon {
    font-size: var(--font-size-lg);
    margin-top: 2px;
    flex-shrink: 0;
  }

  .banner-content {
    flex: 1;
    min-width: 0;
  }

  .banner-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
</style>
