<script lang="ts">
  import type { Snippet } from 'svelte';
  import { toResolvedIcon, type IconSource } from '../../lib/icon';
  import {
    OPTICAL_ICON_RATIO,
    resolveListDensity,
    type ListDensity,
  } from '../../lib/launcher/listDensity';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import AppIcon from '../base/AppIcon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import StatusDot from '../base/StatusDot.svelte';
  import type { ItemStatus } from '../../services/launcher/itemStatusLogic';
  import { t } from '../../services/i18n';

  let {
    selected = false,
    multiSelected = false,
    onclick,
    ondblclick,
    icon,
    extensionId,
    title,
    titleChunks,
    titlePrefix,
    subtitle,
    alias,
    shortcut,
    shortcutPlacement = 'inline',
    typeLabel,
    sourceLabel,
    variant = 'default',
    status = null,
    running = false,
    leading,
    trailing,
    density,
    ...rest
  }: {
    selected?: boolean;
    /** Independent of `selected` (the keyboard cursor) — marks this row as
     *  part of a multi-item selection (e.g. clipboard-history's merge-paste). */
    multiSelected?: boolean;
    onclick?: (e: MouseEvent) => void;
    ondblclick?: (e: MouseEvent) => void;
    icon?: IconSource;
    /** Owner of a remote (`https://`) icon; required for the host fetch. */
    extensionId?: string;
    title: string;
    /** Optional pre-split text chunks with match flags for search term highlighting. */
    titleChunks?: { text: string; match?: boolean }[];
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
    /** Marks an application as open: a small dot under the icon. */
    running?: boolean;
    /** Rendered inside the row's icon box, in place of `icon`. */
    leading?: Snippet;
    trailing?: Snippet;
    /** Overrides the user's list density setting (settings preview). */
    density?: ListDensity;
    [key: string]: any;
  } = $props();

  const d = $derived(density ?? resolveListDensity(settingsService.currentSettings.appearance));
  const iconKind = $derived(toResolvedIcon(icon)?.kind);
  const opticalSize = $derived(Math.round(d.iconSize * OPTICAL_ICON_RATIO));
  const iconSize = $derived(
    iconKind === 'glyph' || iconKind === 'emoji' ? opticalSize : d.iconSize,
  );
</script>

<button
  type="button"
  class="result-item"
  class:selected-result={selected}
  class:multi-selected-result={multiSelected}
  class:hint-row={variant === 'hint'}
  class:two-line={d.twoLine}
  style:--row-h="{d.rowHeight}px"
  style:--row-icon="{d.iconSize}px"
  style:--row-icon-optical="{opticalSize}px"
  style:--row-gap="{d.gap}px"
  style:--row-title="{d.titleSize}px"
  {onclick}
  {ondblclick}
  {...rest}
>
  <div class="row-shell">
    <div class="row-icon">
      {#if leading}
        {@render leading()}
      {:else}
        <AppIcon
          {icon}
          {extensionId}
          size={iconSize}
          glyphSize={Math.round(iconSize * 0.64)}
          emojiSize={iconSize}
          tile
          alt={title}
        />
      {/if}
      {#if running}
        <span class="running-dot" role="img" aria-label={t('search.app_running')}></span>
      {/if}
    </div>

    <div class="row-body">
      <span class="result-title truncate"
        >{#if titlePrefix}<span class="title-prefix">{titlePrefix}</span
          >{/if}{#if titleChunks && titleChunks.length > 0}{#each titleChunks as chunk}{#if chunk.match}<span
                class="search-match">{chunk.text}</span
              >{:else}{chunk.text}{/if}{/each}{:else}{title}{/if}</span
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
          class="row-subtitle font-medium text-[var(--text-secondary)] truncate flex-shrink"
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

  .search-match {
    color: var(--accent-primary);
    font-weight: var(--font-weight-semibold);
  }

  .result-item {
    min-height: var(--row-h);
  }

  .result-title {
    font-size: var(--row-title);
  }

  .row-shell {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--row-gap);
  }

  /* Emoji/text icons stay muted, as before AppIcon. */
  .row-shell :global(.app-icon-emoji) {
    color: var(--text-secondary);
  }

  .row-body {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--space-5);
  }

  .row-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--row-icon);
    height: var(--row-icon);
  }

  .two-line .row-body {
    flex-wrap: wrap;
    row-gap: 0;
    padding-block: var(--space-1);
  }

  .two-line .row-subtitle {
    order: 1;
    flex-basis: 100%;
  }

  .running-dot {
    --running-dot-size: 3px;
    position: absolute;
    left: 50%;
    bottom: calc(-1 * var(--space-2));
    width: var(--running-dot-size);
    height: var(--running-dot-size);
    border-radius: 50%;
    background-color: var(--text-tertiary);
    transform: translateX(-50%);
  }

  .selected-result .running-dot {
    background-color: var(--text-secondary);
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
