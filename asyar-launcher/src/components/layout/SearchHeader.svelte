<script lang="ts">
  import { tick } from 'svelte';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';

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
    oncontextQueryChange?.({ query: contextQuery });
  }

  let hintLabel = $derived(contextHint?.type === 'ai' ? 'Ask AI' : 'Tab');
  let chipColor = $derived(activeContext?.color ?? 'var(--accent-primary)');
</script>

<div class="search-header">
  <div class="relative w-full border-b border-[var(--separator)] flex items-center min-h-[44px] px-4 gap-3">
    {#if showBack}
      <button
        type="button"
        class="back-button-new"
        tabindex="-1"
        onclick={handleBackClick}
        title="Press Escape to go back"
        aria-label="Go back"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        <KeyboardHint keys="Esc" />
      </button>
    {/if}

    {#if activeContext}
      <div class="context-search-row">
        <span class="context-chip" style="background: {chipColor}">
          <span class="chip-icon">
            {#if isBuiltInIcon(activeContext.icon)}
              <Icon name={getBuiltInIconName(activeContext.icon)} size={13} />
            {:else if isIconImage(activeContext.icon)}
              <img src={activeContext.icon} alt="" class="w-4 h-4 object-contain" />
            {:else}
              {activeContext.icon}
            {/if}
          </span>
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
            <span class="hint-icon">
              {#if isBuiltInIcon(contextHint.icon)}
                <Icon name={getBuiltInIconName(contextHint.icon)} size={13} />
              {:else if isIconImage(contextHint.icon)}
                <img src={contextHint.icon} alt="" class="w-4 h-4 object-contain" />
              {:else}
                {contextHint.icon}
              {/if}
            </span>
            <span class="hint-label">{hintLabel}</span>
            {#if contextHint.type !== 'ai'}
              <KeyboardHint keys="Tab" />
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
    font-size: var(--font-size-lg);
    font-weight: 600;
    padding: 0;
  }
  .back-button-new {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background-color var(--transition-normal), color var(--transition-normal);
    user-select: none;
    flex-shrink: 0;
  }
  .back-button-new:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .context-hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-tertiary, rgba(128, 128, 128, 0.15));
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    pointer-events: none;
  }
  .hint-icon { font-size: var(--font-size-md); }
  .hint-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
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
    border-radius: var(--radius-md, 8px);
    padding: 3px 4px 3px 8px;
    font-size: var(--font-size-sm);
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    box-shadow: var(--shadow-xs);
  }
  .chip-icon { font-size: var(--font-size-md); }
  .chip-name {
    font-size: var(--font-size-sm);
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
    font-size: var(--font-size-lg);
    line-height: 1;
    display: flex;
    align-items: center;
    border-radius: var(--radius-xs);
    margin-left: 2px;
  }
  .chip-dismiss:hover { color: white; background: rgba(255,255,255,0.15); }
  .context-query-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-lg);
    font-weight: 600;
    padding: 0;
    min-width: 0;
  }
  .context-query-input::placeholder { color: var(--text-tertiary); }
</style>
