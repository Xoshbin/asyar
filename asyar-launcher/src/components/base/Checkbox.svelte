<script lang="ts">
  let {
    checked = false,
    disabled = false,
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  } = $props();
</script>

<label class="checkbox-wrapper" class:disabled>
  <input
    type="checkbox"
    class="sr-only"
    {checked}
    {disabled}
    onchange={(e) => onchange?.((e.target as HTMLInputElement).checked)}
  />
  <span class="checkbox-box" class:checked>
    {#if checked}
      <svg viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg" class="checkmark">
        <path d="M1 4L3.8 7L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    {/if}
  </span>
</label>

<style>
  .checkbox-wrapper {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-wrapper.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .checkbox-box {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-xs);
    border: 1.5px solid var(--border-color);
    background: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--transition-fast), border-color var(--transition-fast);
    flex-shrink: 0;
  }

  .checkbox-box.checked {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: white;
  }

  .checkbox-wrapper:not(.disabled):hover .checkbox-box:not(.checked) {
    border-color: var(--text-secondary);
  }

  .checkbox-wrapper .sr-only:focus-visible ~ .checkbox-box {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 50%, transparent);
  }

  .checkmark {
    width: 10px;
    height: 8px;
  }
</style>
