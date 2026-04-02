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
    gap: 12px;
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-sm);
    margin-bottom: 1px;
    transition: background var(--transition-fast), box-shadow var(--transition-fast);
    cursor: default;
    user-select: none;
    position: relative;
    overflow: hidden;
  }


  .list-row:hover {
    background: var(--bg-hover);
  }

  .list-row.selected {
    background: var(--bg-selected);
    box-shadow: inset 2px 0 0 var(--accent-primary);
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
    gap: 8px;
    flex-shrink: 0;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
