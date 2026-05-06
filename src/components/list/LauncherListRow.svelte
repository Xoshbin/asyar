<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';

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
    leading?: Snippet;
    trailing?: Snippet;
    [key: string]: any;
  } = $props();
</script>

<button
  type="button"
  class="result-item"
  class:selected-result={selected}
  {onclick}
  {ondblclick}
  {...rest}
>
  <div class="flex items-center w-full" style="gap: 13px">
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
          class="w-[23px] h-[23px] rounded object-contain flex-shrink-0"
        />
      {:else}
        <div class="w-[23px] h-[23px] flex items-center justify-center text-[var(--text-secondary)] text-sm flex-shrink-0 rounded">
          {icon}
        </div>
      {/if}
    {/if}

    <div class="flex-1 flex items-center min-w-0" style="gap: 13px">
      <span class="result-title truncate">{title}</span>
      {#if subtitle}
        <span class="font-medium text-[var(--text-secondary)] truncate flex-shrink" style="font-size: var(--font-size-md)">{subtitle}</span>
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
  .builtin-icon-tile {
    width: 23px;
    height: 23px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 5px;
    background-color: var(--accent-primary);
    color: #fff;
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
