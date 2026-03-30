<script lang="ts">
  import { toDisplayString } from '../../built-in-features/shortcuts/shortcutFormatter';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';

  type Item = MappedSearchItem;

  const MODIFIER_SYMBOLS = new Set(['⌘', '⇧', '⌥', '⌃']);

  function splitShortcutKeys(display: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < display.length && MODIFIER_SYMBOLS.has(display[i])) {
      tokens.push(display[i]);
      i++;
    }
    if (i < display.length) tokens.push(display.slice(i));
    return tokens;
  }

  let {
    items = [],
    selectedIndex = -1,
    onselect
  }: {
    items?: Item[];
    selectedIndex?: number;
    onselect?: (detail: { item: Item }) => void;
  } = $props();
</script>

<div class="max-h-[calc(100vh-52px)] p-1">
  {#each items as item, i}
    <button
      type="button"
      data-index={i}
      class="result-item {item.style === 'large' ? 'calc-large-item' : ''}"
      class:selected-result={i === selectedIndex}
      onclick={() => {
        onselect?.({ item });
      }}
    >
      {#if item.style === 'large'}
        <div class="flex items-center gap-4 w-full px-2 py-4">
          {#if item.icon}
            {#if isBuiltInIcon(item.icon)}
              <div class="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-[var(--asyar-brand-muted)] text-[var(--accent-primary)] shadow-sm border border-[var(--separator)]">
                <Icon name={getBuiltInIconName(item.icon)} size={28} />
              </div>
            {:else if isIconImage(item.icon)}
                <img
                    src={item.icon}
                    alt={item.title}
                    class="flex-shrink-0 w-12 h-12 rounded-xl object-contain shadow-sm border border-[var(--separator)]"
                />
            {:else}
                <div class="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-[var(--accent-primary)]/10 text-2xl shadow-sm border border-[var(--separator)]">
                   {item.icon}
                </div>
            {/if}
          {/if}
          <div class="flex flex-col items-start flex-1 overflow-hidden">
             <div class="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider mb-1">{item.subtitle || 'Calculator'}</div>
             <div class="text-3xl font-light text-[var(--text-primary)] truncate break-all leading-tight w-full text-left">{item.title}</div>
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-2 w-full">
          {#if item.icon}
            {#if isBuiltInIcon(item.icon)}
              <div class="w-7 h-7 flex items-center justify-center text-[var(--accent-primary)] flex-shrink-0 rounded-lg">
                <Icon name={getBuiltInIconName(item.icon)} size={18} />
              </div>
            {:else if isIconImage(item.icon)}
              <img
                src={item.icon}
                alt={item.title}
                class="w-7 h-7 rounded-lg object-contain flex-shrink-0"
              />
            {:else}
              <div class="w-7 h-7 flex items-center justify-center text-[var(--text-secondary)] text-base flex-shrink-0 rounded-lg">
                {item.icon}
              </div>
            {/if}
          {/if}

          <!-- Left: name + optional inline description -->
          <div class="flex-1 flex items-baseline gap-2 min-w-0">
            <span class="result-title truncate">{item.title}</span>
            {#if item.subtitle}
              <span class="text-xs text-[var(--text-tertiary)] truncate flex-shrink">{item.subtitle}</span>
            {/if}
          </div>

          <!-- Right: type label & shortcut -->
          <div class="flex items-center gap-2 flex-shrink-0 ml-auto mr-2">
            {#if item.shortcut}
              <span class="shortcut-keys">
                {#each splitShortcutKeys(toDisplayString(item.shortcut)) as key}
                  <kbd class="shortcut-badge">{key}</kbd>
                {/each}
              </span>
            {/if}
            {#if item.typeLabel}
              <span class="text-xs text-[var(--text-secondary)] flex-shrink-0 font-medium">{item.typeLabel}</span>
            {/if}
          </div>
        </div>
      {/if}
    </button>
  {/each}
</div>

<style>
  .shortcut-keys {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .shortcut-badge {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    padding: 3px 7px 4px;
    color: var(--accent-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-bottom-width: 2px;
    border-radius: var(--radius-xs, 4px);
    letter-spacing: 0.02em;
    flex-shrink: 0;
    user-select: none;
  }

  .calc-large-item {
    border: none;
    border-radius: 0.75rem;
    margin-bottom: 0.5rem;
    transition-property: all;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 200ms;
    background-color: var(--bg-secondary);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
  }
  .calc-large-item:hover {
     box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
     transform: scale(1.01);
  }
  .calc-large-item.selected-result {
    box-shadow: 0 0 0 2px var(--accent-primary), 0 8px 25px rgba(46, 196, 182, 0.12);
    background-color: var(--bg-hover);
  }
</style>
