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
      <kbd class="text-mono">
        <!-- ↵ has a top-heavy bounding box; nudge down to optically center it. -->
        {#if key === '↵'}
          <span class="glyph-return">{key}</span>
        {:else}
          {key}
        {/if}
      </kbd>
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
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    user-select: none;
  }

  .key-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 21px;
    padding: 0 6px;
    background-color: var(--bg-selected);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    border: none;
    /* Soft inset rim. Mirrored to the native macOS chip via nativeBarSync,
       which uses CALayer borderWidth (hard stroke) instead of a blur. */
    box-shadow: inset 0 0 2px 0.5px var(--kbd-rim);
    font-weight: 500;
  }

  .action {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .glyph-return {
    display: inline-block;
    transform: translateY(1px);
    line-height: 1;
  }
</style>
