<script lang="ts">
  type LaunchView = 'default' | 'compact';

  let {
    value = 'default',
    onchange,
  }: {
    value?: LaunchView;
    onchange?: (v: LaunchView) => void;
  } = $props();

  const options: { id: LaunchView; label: string }[] = [
    { id: 'default', label: 'Default' },
    { id: 'compact', label: 'Compact' },
  ];
</script>

<div class="window-mode-selector" role="radiogroup" aria-label="Window mode">
  {#each options as option}
    <button
      class="mode-option"
      class:selected={value === option.id}
      role="radio"
      aria-checked={value === option.id}
      aria-label="{option.label} window mode"
      type="button"
      onclick={() => onchange?.(option.id)}
    >
      <div class="mode-thumbnail">
        {#if option.id === 'default'}
          <div class="inner-window">
            <div class="win-search-bar"></div>
            <div class="win-results">
              <div class="win-row win-row-selected"></div>
              <div class="win-row"></div>
              <div class="win-row"></div>
            </div>
            <div class="win-footer">
              <div class="win-dot"></div>
              <div class="win-dot"></div>
            </div>
          </div>
        {:else}
          <div class="inner-window">
            <div class="win-search-bar"></div>
            <div class="win-footer win-footer-compact">
              <div class="win-dot"></div>
            </div>
          </div>
        {/if}
      </div>
      <span class="mode-label">{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .window-mode-selector {
    display: flex;
    gap: var(--space-5);
  }

  .mode-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: var(--text-secondary);
    transition: color var(--transition-normal);
  }

  .mode-option.selected {
    color: var(--text-primary);
  }

  .mode-option:focus-visible {
    outline: none;
  }

  .mode-option:focus-visible .mode-thumbnail {
    box-shadow: var(--shadow-focus);
  }

  /* Outer container — acts as the window "desktop" background */
  .mode-thumbnail {
    width: 96px;
    height: 76px;
    border-radius: var(--radius-lg);
    border: 2px solid var(--border-color);
    padding: var(--space-3);
    background: var(--bg-tertiary);
    transition: border-color var(--transition-normal);
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .mode-option:hover .mode-thumbnail {
    border-color: var(--text-secondary);
  }

  .mode-option.selected .mode-thumbnail {
    border-color: var(--accent-primary);
  }

  /* Inner window — floats inside the outer container */
  .inner-window {
    width: 100%;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-secondary);
    box-shadow: var(--shadow-xs);
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
  }

  .win-search-bar {
    height: var(--space-3);
    background: var(--bg-tertiary);
    margin: var(--space-1) var(--space-2);
    border-radius: var(--radius-xs);
    border: 1px solid var(--separator);
    flex-shrink: 0;
  }

  .win-results {
    padding: 0 var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
  }

  .win-row {
    height: var(--space-2);
    background: var(--bg-hover);
    border-radius: var(--radius-xs);
  }

  .win-row.win-row-selected {
    background: var(--bg-selected);
  }

  .win-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-top: 1px solid var(--separator);
    flex-shrink: 0;
  }

  .win-footer-compact {
    margin-top: auto;
  }

  .win-dot {
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--border-color);
  }

  .mode-label {
    font-size: var(--font-size-2xs);
    font-family: var(--font-ui);
    font-weight: 500;
  }

  .mode-option.selected .mode-label {
    font-weight: 600;
  }
</style>
