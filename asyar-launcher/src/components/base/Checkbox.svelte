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
        <path
          d="M1.25 4.25L3.75 6.75L8.75 1.25"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {/if}
  </span>
</label>

<style>
  .checkbox-wrapper {
    display: inline-flex;
    align-items: center;
    cursor: default;
    user-select: none;
  }

  .checkbox-wrapper.disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -var(--space-0-5);
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .checkbox-box {
    width: var(--size-sm);
    height: var(--size-sm);
    border-radius: calc(var(--radius-xs) + 1px);
    border: none;
    background: color-mix(in srgb, var(--text-primary) 10%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color var(--transition-fast);
    flex-shrink: 0;
  }

  .checkbox-box.checked {
    background: color-mix(in srgb, var(--text-primary) 15%, transparent);
    color: var(--text-primary);
  }

  .checkbox-wrapper:not(.disabled):hover .checkbox-box {
    background: color-mix(in srgb, var(--text-primary) 18%, transparent);
  }

  .checkbox-wrapper .sr-only:focus-visible ~ .checkbox-box {
    box-shadow: var(--shadow-focus);
  }

  .checkmark {
    width: 9px;
    height: 7px;
  }
</style>
