<script lang="ts">
  import { onMount } from 'svelte';
  import { PLACEHOLDERS } from '../../lib/placeholders';

  let {
    onInsert,
    onClose,
  }: {
    onInsert: (token: string) => void;
    onClose: () => void;
  } = $props();

  let highlightedIndex = $state(0);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      highlightedIndex = Math.min(highlightedIndex + 1, PLACEHOLDERS.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const p = PLACEHOLDERS[highlightedIndex];
      if (p) {
        onInsert(p.token);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  function handleItemClick(token: string) {
    onInsert(token);
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="placeholder-picker">
  <div class="picker-header">Insert Placeholder</div>
  <ul class="picker-list custom-scrollbar" role="listbox">
    {#each PLACEHOLDERS as placeholder, i (placeholder.id)}
      <li
        class="picker-item"
        class:highlighted={i === highlightedIndex}
        role="option"
        aria-selected={i === highlightedIndex}
        onmouseenter={() => { highlightedIndex = i; }}
        onclick={() => handleItemClick(placeholder.token)}
      >
        <span class="picker-label">{placeholder.label}</span>
        {#if placeholder.description}
          <span class="picker-description">{placeholder.description}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .placeholder-picker {
    position: absolute;
    z-index: 50;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px var(--shadow-color);
    overflow: hidden;
  }

  .picker-header {
    padding: 6px 12px;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--border-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .picker-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 280px;
    overflow-y: auto;
  }

  .picker-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 6px 12px;
    min-height: 40px;
    cursor: pointer;
    gap: 2px;
  }

  .picker-item:hover,
  .picker-item.highlighted {
    background: var(--bg-hover);
  }

  .picker-item.highlighted .picker-label {
    color: var(--accent-primary);
  }

  .picker-label {
    font-weight: 600;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .picker-description {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
