<script lang="ts">
  import { toDisplayString } from '../../built-in-features/shortcuts/shortcutFormatter';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';

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

  const calcIconColor: Record<string, string> = {
    '🧮': 'var(--accent-primary)',
    '📏': 'rgb(52,199,89)',
    '💵': 'rgb(255,149,0)',
    '📅': 'rgb(175,82,222)',
    '🔟': 'rgb(255,59,48)',
  };
  const calcIconLabel: Record<string, string> = {
    '🧮': 'Calculator',
    '📏': 'Units',
    '💵': 'Currency',
    '📅': 'Date',
    '🔟': 'Base',
  };
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
        {@const accentColor = item.icon ? (calcIconColor[item.icon] ?? 'var(--accent-primary)') : 'var(--accent-primary)'}
        {@const categoryLabel = item.icon ? (calcIconLabel[item.icon] ?? '') : ''}
        <div class="calc-card" style="--cat-color: {accentColor}">
          <!-- Header bar -->
          <div class="calc-header">
            <div class="calc-header-left">
              <span class="calc-header-icon">{item.icon ?? ''}</span>
              <span class="calc-header-label">{categoryLabel}</span>
            </div>
            <span class="calc-copy-hint">
              <KeyboardHint keys={['↵']} />
            </span>
          </div>
          <!-- Split body -->
          <div class="calc-split">
            <div class="calc-panel">
              <span class="calc-number">{item.subtitle ?? ''}</span>
              <span class="calc-sub-label">Expression</span>
            </div>
            <div class="calc-divider-line"></div>
            <div class="calc-panel">
              <span class="calc-number">{item.title}</span>
              <span class="calc-sub-label">Result</span>
            </div>
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
              <KeyboardHint keys={splitShortcutKeys(toDisplayString(item.shortcut))} />
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
  /* ── Override base result-item padding for large cards ── */
  .calc-large-item {
    padding: 0 !important;
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-2);
    background-color: var(--bg-secondary);
    border: 1px solid color-mix(in srgb, var(--separator) 70%, transparent);
    overflow: hidden;
    transition: background-color var(--transition-smooth), border-color var(--transition-smooth), box-shadow var(--transition-smooth);
  }
  .calc-large-item:hover {
    background-color: var(--bg-hover);
    box-shadow: var(--shadow-sm);
  }
  .calc-large-item.selected-result {
    background-color: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
    box-shadow: var(--shadow-focus);
  }

  /* ── Card wrapper ────────────────────────────────────── */
  .calc-card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* ── Header bar ──────────────────────────────────────── */
  .calc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px 6px;
    border-left: 3px solid var(--cat-color);
    background-color: color-mix(in srgb, var(--cat-color) 10%, transparent);
  }
  .calc-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .calc-header-icon {
    font-size: 13px;
    line-height: 1;
  }
  .calc-header-label {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
    letter-spacing: 0.02em;
  }
  .calc-copy-hint {
    opacity: 0;
    transition: opacity var(--transition-fast);
  }
  .calc-large-item:hover .calc-copy-hint,
  .calc-large-item.selected-result .calc-copy-hint {
    opacity: 1;
  }

  /* ── Split body ──────────────────────────────────────── */
  .calc-split {
    display: flex;
    align-items: stretch;
    border-top: 1px solid var(--separator);
  }
  .calc-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 18px 16px;
    min-width: 0;
  }
  .calc-divider-line {
    width: 1px;
    background-color: var(--separator);
    flex-shrink: 0;
  }
  .calc-number {
    font-family: var(--font-mono);
    font-size: var(--font-size-display);
    font-weight: 300;
    color: var(--text-primary);
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }
  .calc-sub-label {
    font-size: var(--font-size-2xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
  }
</style>
