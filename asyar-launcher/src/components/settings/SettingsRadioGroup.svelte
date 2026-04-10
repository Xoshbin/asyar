<script lang="ts">
  let {
    label,
    description,
    name,
    options,
    value = $bindable(),
    onchange,
    noBorder = false,
  }: {
    label?: string;
    description?: string;
    name: string;
    options: { value: string; label: string; description?: string }[];
    value: string;
    onchange?: (value: string) => void;
    noBorder?: boolean;
  } = $props();

  function handleChange(newValue: string) {
    value = newValue;
    if (onchange) {
      onchange(newValue);
    }
  }
</script>

<div class="settings-radio-group" class:no-border={noBorder}>
  {#if label}
    <div class="label">{label}</div>
  {/if}
  {#if description}
    <div class="description">{description}</div>
  {/if}

  <div class="options-container">
    {#each options as option}
      <label class="option-item">
        <input
          type="radio"
          {name}
          value={option.value}
          checked={value === option.value}
          onchange={() => handleChange(option.value)}
        />
        <div class="option-text">
          <div class="option-label">{option.label}</div>
          {#if option.description}
            <div class="option-description">{option.description}</div>
          {/if}
        </div>
      </label>
    {/each}
  </div>
</div>

<style>
  .settings-radio-group {
    padding: var(--space-6) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-radio-group.no-border {
    border-bottom: none;
  }

  .label {
    font-weight: 500;
    color: var(--text-primary);
    font-size: var(--font-size-base);
  }

  .description {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }

  .options-container {
    margin-top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .option-item {
    display: flex;
    align-items: flex-start;
    cursor: pointer;
    gap: var(--space-3);
  }

  input[type='radio'] {
    margin-top: 3px;
    accent-color: var(--accent-primary);
  }

  .option-label {
    font-weight: 500;
    color: var(--text-primary);
  }

  .option-description {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-top: 2px;
  }
</style>
