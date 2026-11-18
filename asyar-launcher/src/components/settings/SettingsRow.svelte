<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    description = '',
    children,
    below,
  }: {
    label: string;
    description?: string;
    children?: Snippet;
    /** Full-width content under the label, inside the row's divider. */
    below?: Snippet;
  } = $props();
</script>

<div class="settings-row" class:has-below={below}>
  <div class="settings-row-text">
    <div class="settings-row-label">{label}</div>
    {#if description}
      <div class="settings-row-description">{description}</div>
    {/if}
  </div>
  {#if children}
    <div class="settings-row-control">
      {@render children()}
    </div>
  {/if}
  {#if below}
    <div class="settings-row-below">
      {@render below()}
    </div>
  {/if}
</div>

<style>
  .settings-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-7);
    padding: var(--space-4) var(--space-5);
  }

  /* Soft hairline inset on both sides, never after the last row — a border
     on the row itself would be flush, so the divider is a pseudo-element. */
  .settings-row:not(:last-child)::after {
    content: '';
    position: absolute;
    left: var(--space-5);
    right: var(--space-5);
    bottom: 0;
    height: 1px;
    background: var(--separator);
  }

  .settings-row.has-below {
    flex-wrap: wrap;
    row-gap: var(--space-4);
  }

  .settings-row-below {
    flex-basis: 100%;
    min-width: 0;
  }

  .settings-row-text {
    flex: 1;
    min-width: 0;
  }

  .settings-row-label {
    font-size: var(--font-size-md);
    font-weight: 500;
    color: var(--text-primary);
  }

  .settings-row-description {
    margin-top: var(--space-0-5);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .settings-row-control {
    flex-shrink: 0;
  }
</style>
