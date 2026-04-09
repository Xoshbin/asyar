<script lang="ts">
  import KeyboardHint from '../base/KeyboardHint.svelte';

  let {
    label,
    keyHint,
    onclick,
    disabled = false,
    ariaHaspopup,
    ariaExpanded,
    class: className = '',
  }: {
    label: string;
    keyHint?: string | string[];
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    ariaHaspopup?: 'true' | 'false' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
    ariaExpanded?: boolean;
    class?: string;
  } = $props();
</script>

<button
  type="button"
  {onclick}
  {disabled}
  aria-haspopup={ariaHaspopup}
  aria-expanded={ariaExpanded}
  class="bottom-bar-button {className}"
>
  <span class="label text-body">{label}</span>
  {#if keyHint !== undefined}
    <KeyboardHint keys={keyHint} />
  {/if}
</button>

<style>
  .bottom-bar-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    cursor: pointer;
    transition: color var(--transition-fast), background-color var(--transition-fast);
  }

  .bottom-bar-button:hover:not(:disabled) {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .bottom-bar-button:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  .bottom-bar-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .label {
    font-weight: 500;
  }
</style>
