<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchPlaceholders,
    type PlaceholderDefinition,
  } from '../../lib/placeholders/placeholderResolver';

  let {
    onInsert,
    onClose,
  }: {
    onInsert: (token: string) => void;
    onClose: () => void;
  } = $props();

  let highlightedIndex = $state(0);
  let placeholders = $state<PlaceholderDefinition[]>([]);

  onMount(async () => {
    placeholders = await fetchPlaceholders();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      highlightedIndex = Math.min(highlightedIndex + 1, Math.max(0, placeholders.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const p = placeholders[highlightedIndex];
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
    {#each placeholders as placeholder, i (placeholder.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li
        class="picker-item {i === highlightedIndex ? 'highlighted' : ''}"
        role="option"
        aria-selected={i === highlightedIndex}
        onclick={() => handleItemClick(placeholder.token)}
        onmouseenter={() => {
          highlightedIndex = i;
        }}
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
    z-index: var(--z-dropdown);
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
    padding: var(--space-2) var(--space-5);
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
    padding: var(--space-1) 0;
    max-height: 280px;
    overflow-y: auto;
  }

  .picker-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-2) var(--space-5);
    min-height: 40px;
    cursor: pointer;
    gap: var(--space-0-5);
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
