<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Icon } from '../../../../components';

  // A launcher-sized window around a real built-in view; the search bar feeds that view's state.
  let {
    placeholder,
    onquery,
    onmove,
    children,
  }: {
    placeholder: string;
    onquery: (query: string) => void;
    onmove: (direction: 'up' | 'down') => void;
    children: Snippet;
  } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onmove(e.key === 'ArrowUp' ? 'up' : 'down');
  }
</script>

<div class="launcher-frame">
  <div class="launcher-frame__search">
    <Icon name="search" size={18} />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="launcher-frame__input"
      {placeholder}
      oninput={(e) => onquery(e.currentTarget.value)}
      {onkeydown}
      autofocus
    />
  </div>
  <div class="launcher-frame__view">
    {@render children()}
  </div>
</div>

<style>
  .launcher-frame {
    display: flex;
    flex-direction: column;
    height: calc(var(--font-size-md) * 26);
  }
  .launcher-frame__search {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--separator);
    color: var(--text-tertiary);
  }
  .launcher-frame__input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-xl);
    outline: none;
  }
  .launcher-frame__view {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
