<script lang="ts">
  import type { Snippet } from 'svelte';
  import { OPTICAL_ICON_RATIO, resolveListDensity } from '../../lib/launcher/listDensity';
  import { settingsService } from '../../services/settings/settingsService.svelte';

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

  const d = $derived(resolveListDensity(settingsService.currentSettings.appearance));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  class="list-row"
  class:selected
  class:two-line={d.twoLine}
  role="option"
  aria-selected={selected}
  style:--row-h="{d.rowHeight}px"
  style:--row-icon="{d.iconSize}px"
  style:--row-icon-optical="{Math.round(d.iconSize * OPTICAL_ICON_RATIO)}px"
  style:--row-gap="{d.gap}px"
  style:--row-title="{d.titleSize}px"
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
    <div class="list-item-title truncate text-title">{title}</div>
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
    gap: var(--row-gap);
    min-height: var(--row-h);
    padding: var(--space-1) var(--space-6);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-0-5);
    transition: none;
    cursor: default;
    user-select: none;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  /* The selected row: a flat band, the same one `.selected-result` draws in
     the launcher list. Keep it flat — no gradient, no seam, no border. This
     mirrors the global `.list-row.selected` in style.css, which carries the
     full reasoning; the component-scoped copy is what actually wins here, so
     the two have to agree. */
  .list-row.selected {
    background-color: var(--bg-selected);
    box-shadow: inset 0 0 2px 0.5px var(--kbd-rim);
  }

  .list-item-leading {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--row-icon);
    height: var(--row-icon);
  }

  .list-item-leading > :global(svg) {
    width: var(--row-icon-optical);
    height: var(--row-icon-optical);
    color: var(--text-secondary);
  }

  /* One line: the subtitle follows the title, as in LauncherListRow. */
  .list-item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-5);
  }

  .two-line .list-item-content {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .list-item-title {
    font-size: var(--row-title);
    flex-shrink: 0;
    max-width: 100%;
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
