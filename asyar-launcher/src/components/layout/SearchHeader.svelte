<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';

  export let value = "";
  export let showBack: boolean = false;
  export let searchable = true;
  export let placeholder = "Search...";
  export let ref: HTMLInputElement | null = null;
  export let activePortal: { id: string, name: string, icon: string } | null = null;
  export let portalQuery = '';
  export let portalHint: { id: string, name: string, icon: string } | null = null;

  const dispatch = createEventDispatcher();

  let prevPortal: typeof activePortal = null;
  $: if (activePortal !== prevPortal) {
    prevPortal = activePortal;
    if (activePortal) tick().then(() => ref?.focus());
  }

  function handleBackClick() { dispatch('click'); }
  function dismissPortal() { dispatch('portalDismiss'); }
  function handlePortalInput(e: Event) {
    dispatch('portalQueryChange', { query: (e.target as HTMLInputElement).value });
  }
</script>

<div class="search-header">
  <div class="relative w-full border-b-[0.5px] border-gray-400/20 flex items-center min-h-[52px]">
    {#if showBack}
      <button type="button" class="back-button" on:click={handleBackClick}
        on:keydown={(e) => e.key === 'Enter' && handleBackClick()}
        title="Press Escape to go back" aria-label="Go back">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        <kbd class="keyboard-shortcut">Esc</kbd>
      </button>
    {/if}

    {#if activePortal}
      <!-- Committed portal mode: chip + query input -->
      <div class="portal-search-row" class:pl-20={showBack}>
        <span class="portal-chip">
          <span class="chip-icon">{activePortal.icon}</span>
          <span class="chip-name">{activePortal.name}</span>
          <button class="chip-dismiss" on:click={dismissPortal} tabindex="-1" aria-label="Exit portal mode">×</button>
        </span>
        <input
          bind:this={ref}
          type="text"
          value={portalQuery}
          placeholder="Query..."
          autocomplete="off"
          spellcheck="false"
          class="portal-query-input"
          on:input={handlePortalInput}
          on:keydown
        />
      </div>
    {:else}
      <!-- Normal search input with optional portal hint chip -->
      <div class="search-input-row" class:pl-20={showBack}>
        <input
          bind:this={ref}
          type="text"
          {placeholder}
          disabled={!searchable}
          bind:value
          autocomplete="off"
          spellcheck="false"
          class="search-input"
          on:input
          on:keydown
        />
        {#if portalHint}
          <span class="portal-hint">
            <span class="hint-icon">{portalHint.icon}</span>
            <span class="hint-label">Query</span>
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .search-input-row {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    position: relative;
  }
  .search-input-row .search-input {
    flex: 1;
    min-width: 0;
  }
  .portal-hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-tertiary, rgba(128, 128, 128, 0.15));
    border-radius: 5px;
    padding: 3px 8px;
    margin-right: 12px;
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    pointer-events: none;
  }
  .hint-icon { font-size: 13px; }
  .hint-label {
    font-size: 12px;
    font-weight: 500;
  }
  .portal-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    width: 100%;
    height: 100%;
  }
  .portal-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--accent-primary);
    color: white;
    border-radius: 6px;
    padding: 3px 4px 3px 8px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
  }
  .chip-icon { font-size: 13px; }
  .chip-name {
    font-size: 12px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-dismiss {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    padding: 0 4px;
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    border-radius: 3px;
    margin-left: 2px;
  }
  .chip-dismiss:hover { color: white; background: rgba(255,255,255,0.15); }
  .portal-query-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 16px;
    padding: 0;
    min-width: 0;
  }
  .portal-query-input::placeholder { color: var(--text-tertiary); }
</style>
