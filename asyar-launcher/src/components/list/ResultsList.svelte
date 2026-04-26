<script lang="ts">
  import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';

  import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';

  type Item = MappedSearchItem;

  let {
    items = [],
    selectedIndex = -1,
    onselect
  }: {
    items?: Item[];
    selectedIndex?: number;
    onselect?: (detail: { item: Item }) => void;
  } = $props();

  type CalcIconMeta = { color: string; label: string; name: string };
  const CALC_ICONS: Record<string, CalcIconMeta> = {
    '🧮': { color: 'var(--accent-primary)', label: 'Calculator', name: 'calculator' },
    '📏': { color: 'rgb(52,199,89)',        label: 'Units',      name: 'calc-units' },
    '💵': { color: 'rgb(255,149,0)',        label: 'Currency',   name: 'calc-currency' },
    '📅': { color: 'rgb(175,82,222)',       label: 'Date',       name: 'calc-date' },
    '🔟': { color: 'rgb(255,59,48)',        label: 'Base',       name: 'calc-base' },
  };
  const CALC_ICON_FALLBACK: CalcIconMeta = {
    color: 'var(--accent-primary)', label: '', name: 'calculator',
  };
</script>

<div class="p-2">
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
        {@const calc = (item.icon && CALC_ICONS[item.icon]) || CALC_ICON_FALLBACK}
        <div class="calc-card" style="--cat-color: {calc.color}">
          <div class="calc-header">
            <div class="calc-header-left">
              <div class="calc-icon-badge">
                <Icon name={calc.name} size={14} strokeWidth={2} />
              </div>
              <span class="calc-header-label">{calc.label}</span>
            </div>
            <span class="calc-copy-hint">
              <KeyboardHint keys={['↵']} />
            </span>
          </div>
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
        <div class="flex items-center w-full gap-[var(--space-5-5)]">
          {#if item.icon}
            {#if isBuiltInIcon(item.icon)}
              <div class="w-[var(--space-7-5)] h-[var(--space-7-5)] flex items-center justify-center text-[var(--accent-primary)] flex-shrink-0 rounded">
                <Icon name={getBuiltInIconName(item.icon)} size={23} />
              </div>
            {:else if isIconImage(item.icon)}
              <img
                src={item.icon}
                alt={item.title}
                class="w-[var(--space-7-5)] h-[var(--space-7-5)] rounded object-contain flex-shrink-0"
              />
            {:else}
              <div class="w-[var(--space-7-5)] h-[var(--space-7-5)] flex items-center justify-center text-[var(--text-secondary)] text-sm flex-shrink-0 rounded">
                {item.icon}
              </div>
            {/if}
          {/if}

          <div class="flex-1 flex items-center min-w-0 gap-[var(--space-5-5)]">
            <span class="result-title truncate">{item.title}</span>
            {#if item.subtitle}
              <span class="font-medium text-[var(--text-secondary)] truncate flex-shrink" style="font-size: var(--font-size-md)">{item.subtitle}</span>
            {/if}
            {#if item.shortcut && i === selectedIndex}
              <KeyboardHint keys={toDisplayKeys(item.shortcut)} />
            {/if}
          </div>

          <div class="flex items-center gap-2 flex-shrink-0 ml-auto">
            {#if item.typeLabel}
              <span class="font-medium text-[var(--text-secondary)] flex-shrink-0" style="font-size: var(--font-size-md)">{item.typeLabel}</span>
            {/if}
          </div>
        </div>
      {/if}
    </button>
  {/each}
</div>

<style>
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
