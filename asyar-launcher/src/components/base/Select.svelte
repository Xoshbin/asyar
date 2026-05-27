<script lang="ts">
  let {
    value = $bindable(''),
    options = [] as Array<{ value: string; label: string }>,
    disabled = false,
    onchange,
  }: {
    value?: string;
    options?: Array<{ value: string; label: string }>;
    disabled?: boolean;
    onchange?: (value: string) => void;
  } = $props();
</script>

<div class="select-wrap" class:disabled>
  <select
    class="select-el"
    bind:value
    {disabled}
    onchange={(e) => onchange?.((e.target as HTMLSelectElement).value)}
  >
    {#each options as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <svg class="select-caret" viewBox="0 0 10 6" fill="none" aria-hidden="true">
    <path
      d="M1 1l4 4 4-4"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</div>

<style>
  .select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 100%;
  }

  .select-el {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    padding: var(--space-2) var(--space-7) var(--space-2) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    line-height: 1.4;
    cursor: pointer;
    outline: none;
    transition:
      border-color var(--transition-fast),
      box-shadow var(--transition-fast);
  }

  .select-el:focus {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  .select-el:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .select-caret {
    position: absolute;
    right: var(--space-3);
    width: 10px;
    height: 6px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .select-wrap.disabled .select-caret {
    opacity: 0.5;
  }
</style>
