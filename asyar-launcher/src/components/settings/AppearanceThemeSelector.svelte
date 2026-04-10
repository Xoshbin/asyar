<script lang="ts">
  type Theme = 'light' | 'dark' | 'system';

  let {
    value = 'system',
    onchange,
  }: {
    value?: Theme;
    onchange?: (v: Theme) => void;
  } = $props();

  const options: { id: Theme; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];
</script>

<div class="theme-selector" role="radiogroup" aria-label="Appearance theme">
  {#each options as option}
    <button
      class="theme-option"
      class:selected={value === option.id}
      role="radio"
      aria-checked={value === option.id}
      aria-label="{option.label} theme"
      type="button"
      onclick={() => onchange?.(option.id)}
    >
      <div class="theme-circle">
        {#if option.id === 'light'}
          <!-- Sun icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/>
            <line x1="12" y1="2" x2="12" y2="5"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/>
            <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
            <line x1="2" y1="12" x2="5" y2="12"/>
            <line x1="19" y1="12" x2="22" y2="12"/>
            <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
            <line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
          </svg>
        {:else if option.id === 'dark'}
          <!-- Moon icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {:else}
          <!-- System: half-filled circle (contrast icon) -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor"/>
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/>
          </svg>
        {/if}
      </div>
      <span class="theme-label">{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .theme-selector {
    display: flex;
    gap: var(--space-5);
  }

  .theme-option {
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

  .theme-option.selected {
    color: var(--text-primary);
  }

  .theme-option:focus-visible {
    outline: none;
  }

  .theme-option:focus-visible .theme-circle {
    box-shadow: var(--shadow-focus);
  }

  .theme-circle {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: var(--bg-tertiary);
    border: 2px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color var(--transition-normal), background-color var(--transition-normal);
  }

  .theme-option:hover .theme-circle {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }

  .theme-option.selected .theme-circle {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg-primary);
  }

  .theme-label {
    font-size: var(--font-size-2xs);
    font-family: var(--font-ui);
    font-weight: 500;
  }

  .theme-option.selected .theme-label {
    font-weight: 600;
  }
</style>
