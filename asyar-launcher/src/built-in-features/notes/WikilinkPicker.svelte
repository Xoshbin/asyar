<script lang="ts">
  import type { Note } from './noteStore.svelte';

  let {
    candidates,
    query,
    onInsert,
    onClose,
  }: {
    candidates: Note[];
    query: string;
    onInsert: (title: string) => void;
    onClose: () => void;
  } = $props();

  let highlightedIndex = $state(0);

  $effect(() => {
    // Re-clamp whenever the filtered candidate list changes size.
    if (highlightedIndex >= candidates.length)
      highlightedIndex = Math.max(0, candidates.length - 1);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      highlightedIndex = Math.min(highlightedIndex + 1, Math.max(0, candidates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      const c = candidates[highlightedIndex];
      if (c) {
        e.preventDefault();
        e.stopPropagation();
        onInsert(c.title);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="wikilink-picker">
  <div class="picker-header">Link to note</div>
  {#if candidates.length === 0}
    <div class="picker-empty">
      {query.trim() ? `No notes match "${query.trim()}"` : 'No other notes yet'}
    </div>
  {:else}
    <ul class="picker-list custom-scrollbar" role="listbox">
      {#each candidates as note, i (note.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="picker-item {i === highlightedIndex ? 'highlighted' : ''}"
          role="option"
          aria-selected={i === highlightedIndex}
          onclick={() => onInsert(note.title)}
          onmouseenter={() => {
            highlightedIndex = i;
          }}
        >
          {note.title || 'Untitled Note'}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wikilink-picker {
    position: absolute;
    z-index: 50;
    bottom: calc(100% + var(--space-1));
    left: 0;
    min-width: 240px;
    max-width: 360px;
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popup);
    overflow: hidden;
  }

  .picker-header {
    padding: var(--space-2) var(--space-5);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--border-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .picker-empty {
    padding: var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .picker-list {
    list-style: none;
    margin: 0;
    padding: var(--space-1) 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .picker-item {
    padding: var(--space-2) var(--space-5);
    min-height: 32px;
    display: flex;
    align-items: center;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    cursor: pointer;
  }

  .picker-item:hover,
  .picker-item.highlighted {
    background: var(--bg-hover);
  }

  .picker-item.highlighted {
    color: var(--accent-primary);
  }
</style>
