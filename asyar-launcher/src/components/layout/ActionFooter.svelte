<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    left,
    right,
  }: {
    left?: Snippet;
    right?: Snippet;
  } = $props();
</script>

<footer class="action-footer">
  <div class="action-footer-left">
    {#if left}
      {@render left()}
    {/if}
  </div>
  <div class="action-footer-right">
    {#if right}
      {@render right()}
    {/if}
  </div>
</footer>

<style>
  .action-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 16px;
    border-top: 1px solid var(--separator);
    background-color: var(--bg-secondary);
    backdrop-filter: blur(20px);
    flex-shrink: 0;
    z-index: 10;
  }

  .action-footer-left,
  .action-footer-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  :global(.action-footer kbd) {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    padding: 2px 5px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-color);
  }
</style>
