<script lang="ts">
  import { createdExtensionsViewState } from './createdExtensionsViewState.svelte';

  const items = $derived(createdExtensionsViewState.filtered());
  const selectedIndex = $derived(createdExtensionsViewState.selectedIndex);
</script>

<div class="view-container">
  <div class="form-body custom-scrollbar">
    {#if items.length === 0}
      <p class="hint-muted">No extensions yet — build one with "Build Extension with AI".</p>
    {:else}
      <ul class="ext-list">
        {#each items as ext, i (ext.path)}
          <li class="ext-row" class:selected={i === selectedIndex}>
            <div class="ext-main">
              <span class="ext-name">{ext.name}</span>
              <span class="ext-version">v{ext.version}</span>
              <span class="ext-id">{ext.id}</span>
            </div>
            {#if ext.description}<div class="ext-desc">{ext.description}</div>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-7) var(--space-7) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .ext-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .ext-row { padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); }
  .ext-row.selected { background: var(--bg-selected); }
  .ext-main { display: flex; align-items: baseline; gap: var(--space-2); }
  .ext-name { color: var(--text-primary); font-weight: 600; }
  .ext-version { color: var(--text-tertiary); font-size: var(--font-size-sm); }
  .ext-id { color: var(--text-tertiary); font-size: var(--font-size-sm); margin-left: auto; }
  .ext-desc { color: var(--text-secondary); font-size: var(--font-size-sm); margin-top: var(--space-1); }
  .hint-muted { color: var(--text-tertiary); font-size: var(--font-size-sm); margin: 0; line-height: 1.5; }
</style>
