<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    separator = false,
    description = '',
    children,
  }: {
    label: string;
    separator?: boolean;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<div class="form-row" class:separator class:has-description={!!description}>
  <div class="row-label">{label}</div>
  <div class="row-control">
    {@render children()}
  </div>
</div>
{#if description}
  <p class="row-description">{description}</p>
{/if}

<style>
  .form-row {
    display: flex;
    align-items: center;
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--separator);
    gap: var(--space-6);
  }

  .form-row:last-of-type {
    border-bottom: none;
  }

  .form-row.has-description {
    padding-bottom: var(--space-1);
    border-bottom: none;
  }

  .form-row.separator {
    border-top: 1px solid var(--separator);
    padding-top: var(--space-4);
  }

  .row-label {
    width: 9rem;
    text-align: right;
    flex-shrink: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: 500;
    font-family: var(--font-ui);
  }

  .row-control {
    flex: 1;
    min-width: 0;
  }

  .row-description {
    margin: 0;
    padding: 0 var(--space-6) var(--space-2) calc(var(--space-6) + 9rem + var(--space-6));
    border-bottom: 1px solid var(--separator);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    line-height: 1.5;
  }

  .row-description:last-of-type {
    border-bottom: none;
  }
</style>
