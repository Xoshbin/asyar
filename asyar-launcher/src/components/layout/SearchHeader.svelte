<script lang="ts">
  import { tick } from 'svelte';

  let {
    value = $bindable(""),
    showBack = false,
    searchable = true,
    placeholder = "Search...",
    ref = $bindable(null as HTMLInputElement | null),
    activeContext = null,
    contextQuery = $bindable(''),
    contextHint = null,
    onclick,
    oncontextDismiss,
    oncontextQueryChange,
    onkeydown,
    oninput,
  }: {
    value?: string;
    showBack?: boolean;
    searchable?: boolean;
    placeholder?: string;
    ref?: HTMLInputElement | null;
    activeContext?: { id: string; name: string; icon: string; color?: string } | null;
    contextQuery?: string;
    contextHint?: { id: string; name: string; icon: string; type?: string } | null;
    onclick?: () => void;
    oncontextDismiss?: () => void;
    oncontextQueryChange?: (detail: { query: string }) => void;
    onkeydown?: (e: KeyboardEvent) => void;
    oninput?: (e: Event) => void;
  } = $props();

  let prevContextId = $state<string | null>(null);

  $effect(() => {
    if (activeContext?.id !== prevContextId) {
      prevContextId = activeContext?.id ?? null;
      if (activeContext) {
        tick().then(() => {
          if (document.activeElement !== ref) {
            ref?.focus();
          }
        });
      }
    }
  });

  function handleBackClick() {
    onclick?.();
  }

  function dismissContext() {
    oncontextDismiss?.();
  }

  function handleContextInput(e: Event) {
    tick().then(() => {
      oncontextQueryChange?.({ query: contextQuery });
    });
  }

  let hintLabel = $derived(contextHint?.type === 'ai' ? 'Ask AI' : 'Tab');
  let chipColor = $derived(activeContext?.color ?? 'var(--accent-primary)');
</script>

<div class="search-header">
  <div class="relative w-full border-b-[0.5px] border-gray-400/20 flex items-center min-h-[52px] px-4 gap-3">
    {#if showBack}
      <button
        type="button"
        class="back-button-new"
        onclick={handleBackClick}
        onkeydown={(e) => e.key === 'Enter' && handleBackClick()}
        title="Press Escape to go back"
        aria-label="Go back"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        <kbd class="keyboard-inner">Esc</kbd>
      </button>
    {/if}

    {#if activeContext}
      <div class="context-search-row">
        <span class="context-chip" style="background: {chipColor}">
          <span class="chip-icon">{activeContext.icon}</span>
          <span class="chip-name">{activeContext.name}</span>
          <button class="chip-dismiss" onclick={dismissContext} tabindex="-1" aria-label="Exit context mode">×</button>
        </span>
        <input
          bind:this={ref}
          type="text"
          bind:value={contextQuery}
          placeholder="Query..."
          autocomplete="off"
          spellcheck="false"
          class="context-query-input"
          oninput={handleContextInput}
          {onkeydown}
        />
      </div>
    {:else}
      <div class="search-input-row">
        <input
          bind:this={ref}
          type="text"
          {placeholder}
          disabled={!searchable}
          bind:value
          autocomplete="off"
          spellcheck="false"
          class="search-input-clean"
          {oninput}
          {onkeydown}
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
    flex: 1;
    min-width: 0;
    height: 100%;
    position: relative;
  }
  .search-input-clean {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 16px;
    padding: 0;
  }
  .back-button-new {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    user-select: none;
    flex-shrink: 0;
  }
  .back-button-new:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .keyboard-inner {
    font-size: 10px;
    opacity: 0.6;
    background: rgba(128, 128, 128, 0.1);
    padding: 1px 4px;
    border-radius: 3px;
    border: 0.5px solid var(--border-color);
  }
  .context-hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-tertiary, rgba(128, 128, 128, 0.15));
    border-radius: 5px;
    padding: 3px 8px;
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
    gap: 10px;
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .context-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: white;
    border-radius: 6px;
    padding: 3px 4px 3px 8px;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  }
  .chip-icon { font-size: 13px; }
  .chip-name {
    font-size: 12px;
    max-width: 120px;
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
