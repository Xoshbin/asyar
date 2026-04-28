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
  const calcIconName: Record<string, string> = {
    '🧮': 'calculator',
    '📏': 'calc-units',
    '💵': 'calc-currency',
    '📅': 'calc-date',
    '🔟': 'calc-base',
  };
</script>

<div class="max-h-[calc(100vh-52px)] p-2">
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
        {@const iconName = item.icon ? (calcIconName[item.icon] ?? 'calculator') : 'calculator'}
        <div class="calc-card" style="--cat-color: {accentColor}">
          <!-- Header -->
          <div class="calc-header">
            <div class="calc-header-left">
              <div class="calc-icon-badge">
                <Icon name={iconName} size={14} strokeWidth={2} />
              </div>
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
            <div class="calc-divider"></div>
            <div class="calc-panel">
              <span class="calc-number calc-result-value">{item.title}</span>
              <span class="calc-sub-label">Result</span>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-2 w-full">
          {#if item.icon}
            {#if isBuiltInIcon(item.icon)}
              <div class="w-8 h-8 flex items-center justify-center text-[var(--accent-primary)] flex-shrink-0 rounded-lg">
                <Icon name={getBuiltInIconName(item.icon)} size={20} />
              </div>
            {:else if isIconImage(item.icon)}
              <img
                src={item.icon}
                alt={item.title}
                class="w-8 h-8 rounded-lg object-contain flex-shrink-0"
              />
            {:else}
              <div class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] text-base flex-shrink-0 rounded-lg">
                {item.icon}
              </div>
            {/if}
          {/if}

          <!-- Left: name + subtitle -->
          <div class="flex-1 flex items-center gap-3 min-w-0">
            <span class="result-title truncate">{item.title}</span>
            {#if item.subtitle}
              <span class="text-sm text-[var(--text-secondary)] truncate flex-shrink">{item.subtitle}</span>
            {/if}
          </div>

          <!-- Right cluster: alias chip + shortcut to the left of the type label -->
          <div class="flex items-center gap-2 flex-shrink-0 ml-auto mr-2">
            {#if item.alias}
              <span data-test="alias-chip" class="alias-chip text-mono">{item.alias}</span>
            {/if}
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
  /* ── Alias chip ───────────────────────────────────────── */
  /* Distinct from kbd shortcuts: flat, no border/shadow,
     slightly muted fill. Same height (18px) so it aligns
     with the kbd row. */
  .alias-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    min-width: 18px;
    padding: 0 6px;
    border-radius: var(--radius-xs);
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    user-select: none;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  /* ── Card container (overrides .result-item) ─────────── */
  .calc-large-item {
    padding: 0 !important;
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-2);
    overflow: hidden;
    background:
      radial-gradient(ellipse at 0% 0%, color-mix(in srgb, var(--cat-color) 10%, transparent), transparent 65%),
      var(--bg-secondary);
    border: 1px solid color-mix(in srgb, var(--cat-color) 12%, var(--separator));
    box-shadow:
      0 1px 3px color-mix(in srgb, var(--cat-color) 6%, transparent),
      0 4px 12px rgba(0, 0, 0, 0.04);
    transition:
      background var(--transition-smooth),
      border-color var(--transition-smooth),
      box-shadow var(--transition-smooth);
  }

  .calc-large-item:hover {
    background:
      radial-gradient(ellipse at 0% 0%, color-mix(in srgb, var(--cat-color) 14%, transparent), transparent 65%),
      var(--bg-secondary);
    box-shadow:
      0 2px 6px color-mix(in srgb, var(--cat-color) 10%, transparent),
      0 6px 16px rgba(0, 0, 0, 0.06);
  }

  .calc-large-item.selected-result {
    background:
      radial-gradient(ellipse at 0% 0%, color-mix(in srgb, var(--cat-color) 16%, transparent), transparent 65%),
      var(--bg-secondary);
    border-color: color-mix(in srgb, var(--cat-color) 35%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--cat-color) 15%, transparent),
      0 2px 8px color-mix(in srgb, var(--cat-color) 15%, transparent),
      0 8px 24px color-mix(in srgb, var(--cat-color) 8%, transparent);
  }

  /* ── Card layout ─────────────────────────────────────── */
  .calc-card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* ── Header ──────────────────────────────────────────── */
  .calc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
  }
  .calc-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .calc-icon-badge {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      145deg,
      var(--cat-color),
      color-mix(in srgb, var(--cat-color) 72%, black)
    );
    color: white;
    box-shadow:
      0 2px 6px color-mix(in srgb, var(--cat-color) 35%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    flex-shrink: 0;
  }
  .calc-header-label {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
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
    border-top: 1px solid color-mix(in srgb, var(--cat-color) 8%, var(--separator));
  }
  .calc-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 14px 18px 18px;
    min-width: 0;
  }
  .calc-divider {
    width: 1px;
    margin: 10px 0;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, var(--cat-color) 25%, var(--separator)),
      transparent
    );
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
    letter-spacing: -0.02em;
  }
  .calc-result-value {
    font-weight: 400;
  }
  .calc-sub-label {
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
  }
</style>
