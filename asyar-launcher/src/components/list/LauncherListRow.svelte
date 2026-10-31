<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import StatusDot from '../base/StatusDot.svelte';
  import type { ItemStatus } from '../../services/launcher/itemStatusLogic';

  let {
    selected = false,
    multiSelected = false,
    onclick,
    ondblclick,
    icon,
    title,
    titlePrefix,
    subtitle,
    alias,
    shortcut,
    shortcutPlacement = 'inline',
    typeLabel,
    sourceLabel,
    variant = 'default',
    status = null,
    leading,
    trailing,
    ...rest
  }: {
    selected?: boolean;
    /** Independent of `selected` (the keyboard cursor) — marks this row as
     *  part of a multi-item selection (e.g. clipboard-history's merge-paste). */
    multiSelected?: boolean;
    onclick?: (e: MouseEvent) => void;
    ondblclick?: (e: MouseEvent) => void;
    icon?: string;
    title: string;
    /** Dimmed text rendered inline before the title (e.g. `folder/`). */
    titlePrefix?: string;
    subtitle?: string;
    alias?: string;
    shortcut?: string;
    shortcutPlacement?: 'inline' | 'trailing';
    /** What the row is, on the right edge. */
    typeLabel?: string;
    /** Where the row comes from; muted after the title, yields to `subtitle`. */
    sourceLabel?: string;
    /**
     * `'hint'` is the one look for every hint in the launcher — an offer to the
     * user, not a result: a soft accent tint, the title in the accent colour,
     * and the subtitle as a chip (keep it a short token such as `@Coffee`, the
     * thing the row will type or press). Defined here and nowhere else.
     */
    variant?: 'default' | 'hint';
    /**
     * Run-state dot rendered between the title and shortcut. `'active'` is
     * info-coloured + pulsing (a live run), `'done'` is success-coloured + static
     * (a recently-succeeded run within the 10-min done window). `null` renders
     * nothing. Derivation lives in services/launcher/itemStatusLogic.ts.
     */
    status?: ItemStatus | null;
    leading?: Snippet;
    trailing?: Snippet;
    [key: string]: any;
  } = $props();
</script>

<button
  type="button"
  class="result-item"
  class:selected-result={selected}
  class:multi-selected-result={multiSelected}
  class:hint-row={variant === 'hint'}
  {onclick}
  {ondblclick}
  {...rest}
>
  <div class="row-shell">
    {#if leading}
      {@render leading()}
    {:else if icon}
      {#if isBuiltInIcon(icon)}
        <div class="builtin-icon-tile">
          <Icon name={getBuiltInIconName(icon)} size={14} />
        </div>
      {:else if isIconImage(icon)}
        <img src={icon} alt={title} class="row-icon-img" />
      {:else}
        <div class="row-icon-fallback">
          {icon}
        </div>
      {/if}
    {/if}

    <div class="row-body">
      <span class="result-title truncate"
        >{#if titlePrefix}<span class="title-prefix">{titlePrefix}</span>{/if}{title}</span
      >
      {#if status}
        <StatusDot
          color={status === 'active' ? 'info' : status === 'failed' ? 'danger' : 'success'}
          pulse={status === 'active'}
          size={6}
        />
      {/if}
      {#if variant === 'hint' && subtitle}
        <span data-test="hint-chip" class="hint-chip text-mono">{subtitle}</span>
      {:else if subtitle || sourceLabel}
        <span
          class="font-medium text-[var(--text-secondary)] truncate flex-shrink"
          style="font-size: var(--font-size-md)">{subtitle || sourceLabel}</span
        >
      {/if}
      {#if alias}
        <span data-test="alias-chip" class="alias-chip text-mono">{alias}</span>
      {/if}
      {#if shortcut && shortcutPlacement === 'inline'}
        <KeyboardHint keys={toDisplayKeys(shortcut)} />
      {/if}
    </div>

    {#if trailing}
      {@render trailing()}
    {:else if shortcut && shortcutPlacement === 'trailing'}
      <div class="flex-shrink-0 ml-auto">
        <KeyboardHint keys={toDisplayKeys(shortcut)} />
      </div>
    {:else if typeLabel}
      <span
        class="font-medium text-[var(--text-secondary)] flex-shrink-0 ml-auto"
        style="font-size: var(--font-size-md)">{typeLabel}</span
      >
    {/if}
  </div>
</button>

<style>
  .title-prefix {
    color: var(--text-secondary);
  }

  .row-shell {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--space-5);
  }

  .row-body {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--space-5);
  }

  .row-icon-img {
    /* design-ok: 22px row icon matches the reference density; off the 4px size grid until the design language is revised */
    width: 22px;
    height: 22px;
    object-fit: contain;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
  }

  .row-icon-fallback {
    /* design-ok: 22px row icon matches the reference density; off the 4px size grid until the design language is revised */
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    flex-shrink: 0;
    border-radius: var(--radius-xs);
  }

  .builtin-icon-tile {
    /* design-ok: 22px row icon matches the reference density; off the 4px size grid until the design language is revised */
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background-color: var(--accent-primary-fill);
    color: var(--text-on-accent);
  }

  /* The hint row, shared by every hint in the launcher. The tint and the text come from the
     same accent ramp (the house formula), so they always agree. The selected
     band is left to .selected-result, which is never restyled; the accent title
     and chip stay on purpose, so a selected hint still reads as an offer. */
  .hint-row:not(.selected-result) {
    background-color: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .hint-row:not(.selected-result):hover {
    background-color: color-mix(in srgb, var(--accent-primary) 16%, transparent);
  }

  .hint-row .result-title {
    color: var(--accent-primary);
  }

  .hint-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: color-mix(in srgb, var(--accent-primary) 16%, transparent);
    color: var(--accent-primary);
    font-size: var(--font-size-sm);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    user-select: none;
    flex-shrink: 0;
  }

  .alias-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* design-ok: 18px alias pill matches the reference density; off the 4px size grid until the design language is revised */
    height: 18px;
    min-width: 18px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    border: none;
    background-color: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    user-select: none;
    flex-shrink: 0;
    box-sizing: border-box;
  }
</style>
