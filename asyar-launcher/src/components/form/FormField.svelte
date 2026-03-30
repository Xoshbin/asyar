<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    hint = '',
    error = '',
    id = '',
    children,
  }: {
    label: string;
    hint?: string;
    error?: string;
    id?: string;
    children: Snippet;
  } = $props();
</script>

<div class="form-field" class:has-error={!!error}>
  <label class="form-field-label" for={id || undefined}>{label}</label>
  <div class="form-field-control">
    {@render children()}
  </div>
  {#if error}
    <p class="form-field-error">{error}</p>
  {:else if hint}
    <p class="form-field-hint">{hint}</p>
  {/if}
</div>

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .form-field-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
  }

  .form-field-control {
    display: flex;
    flex-direction: column;
  }

  .form-field-hint {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin: 0;
  }

  .form-field-error {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    margin: 0;
  }
</style>
