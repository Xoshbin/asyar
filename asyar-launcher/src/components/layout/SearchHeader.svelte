<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';

  export let value = "";
  export let showBack: boolean = false;
  export let searchable = true;
  export let placeholder = "Search...";
  export let ref: HTMLInputElement | null = null;
  /** The currently committed context mode (portal, AI, etc.) */
  export let activeContext: { id: string, name: string, icon: string, color?: string } | null = null;
  export let contextQuery = '';
  /** Non-committed hint chip shown while user is typing a trigger */
  export let contextHint: { id: string, name: string, icon: string, type?: string } | null = null;

  const dispatch = createEventDispatcher();

  let prevContextId: string | null = null;
  $: if (activeContext?.id !== prevContextId) {
    prevContextId = activeContext?.id ?? null;
    if (activeContext) tick().then(() => { if (document.activeElement !== ref) ref?.focus(); });
  }

  function handleBackClick() { dispatch('click'); }
  function dismissContext() { dispatch('contextDismiss'); }
  function handleContextInput(e: Event) {
    tick().then(() => {
      dispatch('contextQueryChange', { query: contextQuery });
    });
  }

  /** Label shown on the hint chip — portals say "Query", AI says "Ask AI" */
  $: hintLabel = contextHint?.type === 'ai' ? 'Ask AI' : 'Tab';
  $: chipColor = activeContext?.color ?? 'var(--accent-primary)';
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

    {#if activeContext}
      <!-- Committed context mode: chip + query input -->
      <div class="context-search-row" class:pl-20={showBack}>
        <span class="context-chip" style="background: {chipColor}">
          <span class="chip-icon">{activeContext.icon}</span>
          <span class="chip-name">{activeContext.name}</span>
          <button class="chip-dismiss" on:click={dismissContext} tabindex="-1" aria-label="Exit context mode">×</button>
        </span>
        <input
          bind:this={ref}
          type="text"
          bind:value={contextQuery}
          placeholder="Query..."
          autocomplete="off"
          spellcheck="false"
          class="context-query-input"
          on:input={handleContextInput}
          on:keydown
        />
      </div>
    {:else}
      <!-- Normal search input with optional hint chip -->
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
        {#if contextHint}
          <span class="context-hint">
            <span class="hint-icon">{contextHint.icon}</span>
            <span class="hint-label">{hintLabel}</span>
            {#if contextHint.type !== 'ai'}
              <kbd class="hint-key">Tab</kbd>
            {/if}
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
  .context-hint {
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
  .hint-key {
    font-size: 10px;
    background: var(--bg-secondary);
    border: 0.5px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 4px;
    color: var(--text-tertiary);
    margin-left: 2px;
  }
  .context-search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    width: 100%;
    height: 100%;
  }
  .context-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    /* background set inline via chipColor reactive var */
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
  .context-query-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 16px;
    padding: 0;
    min-width: 0;
  }
  .context-query-input::placeholder { color: var(--text-tertiary); }
</style>
