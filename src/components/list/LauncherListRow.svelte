<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import StatusDot from '../base/StatusDot.svelte';
  import type { ItemStatus } from '../../services/launcher/itemStatusLogic';
  import { nowTicker } from '../../lib/nowTicker.svelte';
  import { formatElapsed } from '../run/runningSectionLogic';

  let {
    selected = false,
    onclick,
    ondblclick,
    icon,
    title,
    subtitle,
    alias,
    shortcut,
    shortcutPlacement = 'inline',
    typeLabel,
    status = null,
    runningSince = null,
    leading,
    trailing,
    ...rest
  }: {
    selected?: boolean;
    onclick?: (e: MouseEvent) => void;
    ondblclick?: (e: MouseEvent) => void;
    icon?: string;
    title: string;
    subtitle?: string;
    alias?: string;
    shortcut?: string;
    shortcutPlacement?: 'inline' | 'trailing';
    typeLabel?: string;
    /**
     * Run-state dot rendered between the title and shortcut. `'active'` is
     * info-coloured (a live run), `'done'` is success-coloured (a
     * recently-succeeded run within the 10-min done window), `'failed'`
     * is danger-coloured. `null` renders nothing. Derivation lives in
     * services/launcher/itemStatusLogic.ts.
     */
    status?: ItemStatus | null;
    /**
     * Unix-ms start time of the matching live run. When set and
     * status === 'active', a live-ticking elapsed token (e.g. "12s") takes
     * over the subtitle slot. Passed in by the caller rather than read from
     * runService here.
     */
    runningSince?: number | null;
    leading?: Snippet;
    trailing?: Snippet;
    [key: string]: any;
  } = $props();

  // Subscribe to the shared ticker only while this row is showing a live
  // run. Refcounted, so dozens of rows still share one interval.
  $effect(() => {
    if (status !== 'active' || runningSince === null) return;
    return nowTicker.subscribe();
  });

  // A live run takes over the subtitle slot with its elapsed token; split
  // out so it can carry the tabular-nums style (see .elapsed-token).
  let elapsedToken = $derived(
    status === 'active' && runningSince !== null
      ? formatElapsed(Math.max(0, nowTicker.now - runningSince))
      : null,
  );
  let staticSubtitle = $derived(elapsedToken === null ? subtitle : null);
</script>

<button
  type="button"
  class="result-item"
  class:selected-result={selected}
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
          <Icon name={getBuiltInIconName(icon)} size={15} />
        </div>
      {:else if isIconImage(icon)}
        <img
          src={icon}
          alt={title}
          class="row-icon-img"
        />
      {:else}
        <div class="row-icon-fallback">
          {icon}
        </div>
      {/if}
    {/if}

    <div class="row-body">
      <span class="result-title truncate">{title}</span>
      {#if status}
        <StatusDot
          color={status === 'active' ? 'info' : status === 'failed' ? 'danger' : 'success'}
          size={6}
        />
      {/if}
      {#if elapsedToken !== null}
        <span class="font-medium text-[var(--text-secondary)] flex-shrink-0 elapsed-token" style="font-size: var(--font-size-md)">{elapsedToken}</span>
      {:else if staticSubtitle}
        <span class="font-medium text-[var(--text-secondary)] truncate flex-shrink" style="font-size: var(--font-size-md)">{staticSubtitle}</span>
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
      <span class="font-medium text-[var(--text-secondary)] flex-shrink-0 ml-auto" style="font-size: var(--font-size-md)">{typeLabel}</span>
    {/if}
  </div>
</button>

<style>
  .row-shell {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--space-5-5);
  }

  .row-body {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--space-5-5);
  }

  .row-icon-img {
    width: var(--space-7-5);
    height: var(--space-7-5);
    object-fit: contain;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
  }

  .row-icon-fallback {
    width: var(--space-7-5);
    height: var(--space-7-5);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    flex-shrink: 0;
    border-radius: var(--radius-xs);
  }

  .builtin-icon-tile {
    width: var(--space-7-5);
    height: var(--space-7-5);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background-color: var(--accent-primary);
    color: #fff;
  }

  /* tabular-nums so the ticking elapsed value doesn't reflow as digits
     change width (1 → 2 → 9 share one advance). */
  .elapsed-token {
    font-variant-numeric: tabular-nums;
  }

  .alias-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--space-7);
    min-width: var(--space-7);
    padding: 0 var(--space-2);
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-color);
    background-color: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    user-select: none;
    flex-shrink: 0;
    box-sizing: border-box;
  }
</style>
