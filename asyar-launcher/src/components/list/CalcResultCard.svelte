<script lang="ts">
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import { createFitGroup, fitText } from '../../lib/fitText';

  import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';

  let {
    item,
    index,
    selected = false,
    onclick,
  }: {
    item: MappedSearchItem;
    index: number;
    selected?: boolean;
    onclick?: () => void;
  } = $props();

  type CalcIconMeta = { color: string; label: string; name: string };
  // Keys are the icons emitted by the calculator extension (one per CalcKind).
  const CALC_ICONS: Record<string, CalcIconMeta> = {
    '🧮': { color: 'var(--accent-primary)', label: 'Calculator', name: 'calculator' },
    '📏': { color: 'rgb(52,199,89)', label: 'Units', name: 'calc-units' },
    '💵': { color: 'rgb(255,149,0)', label: 'Currency', name: 'calc-currency' },
    '📅': { color: 'rgb(175,82,222)', label: 'Date', name: 'calc-date' },
    '🕒': { color: 'rgb(90,200,250)', label: 'Time', name: 'calc-time' },
    '🔢': { color: 'rgb(255,59,48)', label: 'Base', name: 'calc-base' },
    '🎨': { color: 'rgb(255,45,85)', label: 'Color', name: 'palette' },
    '％': { color: 'rgb(88,86,214)', label: 'Percent', name: 'calc-percent' },
    '➗': { color: 'rgb(0,199,190)', label: 'Ratio', name: 'calc-ratio' },
  };
  const CALC_ICON_FALLBACK: CalcIconMeta = {
    color: 'var(--accent-primary)',
    label: '',
    name: 'calculator',
  };

  const calc = $derived((item.icon && CALC_ICONS[item.icon]) || CALC_ICON_FALLBACK);

  // Expression and Result always shrink to the same size, so the two
  // panels stay visually balanced.
  const fitGroup = createFitGroup();
</script>

<button
  type="button"
  data-index={index}
  class="result-item calc-large-item"
  class:selected-result={selected}
  {onclick}
>
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
        <span class="calc-number" use:fitText={fitGroup}>{item.subtitle ?? ''}</span>
        <span class="calc-sub-label">Expression</span>
      </div>
      <div class="calc-divider"></div>
      <div class="calc-panel">
        <span class="calc-number calc-result-value" use:fitText={fitGroup}>{item.title}</span>
        <span class="calc-sub-label">Result</span>
      </div>
    </div>
  </div>
</button>

<style>
  /* ── Card container (overrides .result-item) ─────────── */
  .calc-large-item {
    padding: 0 !important;
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-2);
    overflow: hidden;
    background:
      radial-gradient(
        ellipse at 0% 0%,
        color-mix(in srgb, var(--cat-color) 10%, transparent),
        transparent 65%
      ),
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
      radial-gradient(
        ellipse at 0% 0%,
        color-mix(in srgb, var(--cat-color) 14%, transparent),
        transparent 65%
      ),
      var(--bg-secondary);
    box-shadow:
      0 2px 6px color-mix(in srgb, var(--cat-color) 10%, transparent),
      0 6px 16px rgba(0, 0, 0, 0.06);
  }

  .calc-large-item.selected-result {
    background:
      radial-gradient(
        ellipse at 0% 0%,
        color-mix(in srgb, var(--cat-color) 16%, transparent),
        transparent 65%
      ),
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
    padding: var(--space-4) var(--space-5-5) var(--space-3);
  }
  .calc-header-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .calc-icon-badge {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      145deg,
      var(--cat-color),
      color-mix(in srgb, var(--cat-color) 72%, black)
    );
    color: var(--text-on-accent);
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
    gap: var(--space-1-5);
    padding: var(--space-5-5) var(--space-7) var(--space-7);
    min-width: 0;
  }
  .calc-divider {
    width: 1px;
    margin: var(--space-4) 0;
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
    letter-spacing: -0.02em;
  }
  /* Extreme inputs that overflow even at the minimum font size fade out
     at the edge instead of showing a hard "…". The attribute is set at
     runtime by fitText, so :global() keeps Svelte from pruning this. */
  :global(.calc-number[data-overflowing='true']) {
    -webkit-mask-image: linear-gradient(to right, black calc(100% - var(--space-8)), transparent);
    mask-image: linear-gradient(to right, black calc(100% - var(--space-8)), transparent);
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
