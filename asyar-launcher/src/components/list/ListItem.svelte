<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    selected = false,
    onclick,
    ondblclick,
    leading,
    title,
    subtitle,
    trailing,
    ...restProps
  }: {
    selected?: boolean;
    onclick?: (e: MouseEvent) => void;
    ondblclick?: (e: MouseEvent) => void;
    leading?: Snippet;
    title: string;
    subtitle?: string | Snippet;
    trailing?: Snippet;
    [key: string]: any;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  class="list-row"
  class:selected
  role="option"
  aria-selected={selected}
  {onclick}
  {ondblclick}
  {...restProps}
>
  {#if leading}
    <div class="list-item-leading">
      {@render leading()}
    </div>
  {/if}

  <div class="list-item-content">
    <div class="truncate text-title">{title}</div>
    {#if typeof subtitle === 'function'}
      <div class="truncate text-caption">
        {@render subtitle()}
      </div>
    {:else if subtitle}
      <div class="truncate text-caption">{subtitle}</div>
    {/if}
  </div>

  {#if trailing}
    <div class="list-item-trailing">
      {@render trailing()}
    </div>
  {/if}
</div>

<style>
  .list-row {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-0-5);
    transition: none;
    cursor: default;
    user-select: none;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  /* THE BLOOM. The selected row is the one lit thing on screen, so it is lit
     rather than boxed: the accent washes in from the left seam where the beam
     lands and falls off across the row. This mirrors the global
     `.list-row.selected` in style.css — the component-scoped copy is what
     actually wins here, so the two have to agree. */
  .list-row.selected {
    background:
      linear-gradient(
        to right,
        var(--bg-selected),
        color-mix(in srgb, var(--bg-selected) 35%, transparent) 68%,
        transparent
      ),
      linear-gradient(to right, var(--accent-primary) 0 2px, transparent 2px);
    box-shadow: inset 0 1px 0 0 var(--rim-light);
  }

  .list-item-leading {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .list-item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .list-item-trailing {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
