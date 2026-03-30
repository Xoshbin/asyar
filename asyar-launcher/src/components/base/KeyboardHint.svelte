<script lang="ts">
  let {
    keys,
    action,
  }: {
    keys: string | string[];
    action?: string;
  } = $props();

  const keyList = $derived(Array.isArray(keys) ? keys : [keys]);
</script>

<div class="keyboard-hint">
  <div class="key-group">
    {#each keyList as key}
      <kbd class="text-mono">{key}</kbd>
    {/each}
  </div>
  {#if action}
    <span class="action text-caption">{action}</span>
  {/if}
</div>

<style>
  .keyboard-hint {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
    user-select: none;
  }

  .key-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-color);
    box-shadow: 0 1px 0 var(--border-color);
    font-weight: 500;
  }

  .action {
    color: var(--text-tertiary);
    font-weight: 400;
  }
</style>
