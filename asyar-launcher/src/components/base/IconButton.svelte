<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    onclick,
    disabled = false,
    title,
    ariaLabel,
    tabindex,
    class: className = '',
    variant = 'ghost',
    size = 'md',
    children,
  }: {
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    tabindex?: number;
    class?: string;
    variant?: 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  {disabled}
  {title}
  {onclick}
  aria-label={ariaLabel}
  {tabindex}
  class="icon-button size-{size} variant-{variant} {className}"
>
  {@render children()}
</button>

<style>
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast), color var(--transition-fast);
    font-family: var(--font-ui);
    line-height: 1;
  }

  .size-sm {
    width: var(--space-6);
    height: var(--space-6);
    font-size: var(--font-size-xs);
  }

  .size-md {
    width: var(--space-8);
    height: var(--space-8);
    font-size: var(--font-size-sm);
  }

  .size-lg {
    width: var(--space-9);
    height: var(--space-9);
    font-size: var(--font-size-base);
  }

  .icon-button:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-button:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  .icon-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .variant-danger {
    color: var(--text-tertiary);
  }

  .variant-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
    color: var(--accent-danger);
  }
</style>
