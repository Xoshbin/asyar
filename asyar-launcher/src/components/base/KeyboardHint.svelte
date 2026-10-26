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
    gap: var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    user-select: none;
  }

  .key-group {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* design-ok: 18px key cap matches the reference density; off the 4px size grid until the design language is revised */
    min-width: 18px;
    height: 18px;
    padding: 0 var(--space-1);
    /* An outlined cap: a hairline edge and no fill, so it reads the same on
       glass, on a hovered row and on the selected row. */
    background-color: transparent;
    color: var(--text-secondary);
    /* design-ok: 5px suits the 18px cap; --radius-xs is too square, --radius-sm too round */
    border-radius: 5px;
    border: 1px solid var(--kbd-border);
    box-sizing: border-box;
    font-weight: 500;
    line-height: 1;
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
