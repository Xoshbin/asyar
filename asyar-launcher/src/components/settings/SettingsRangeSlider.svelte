<script lang="ts">
  let {
    min,
    max,
    step = 1,
    value = $bindable(),
    suffix = '',
    onchange,
  }: {
    min: number;
    max: number;
    step?: number;
    value: number;
    suffix?: string;
    onchange?: (value: number) => void;
  } = $props();

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    const newValue = parseInt(e.currentTarget.value);
    value = newValue;
    if (onchange) {
      onchange(newValue);
    }
  }
</script>

<div class="settings-range-slider">
  <input type="range" {min} {max} {step} {value} oninput={handleInput} />
  <span class="value-display">
    {value}{suffix}
  </span>
</div>

<style>
  .settings-range-slider {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  input[type='range'] {
    width: 8rem;
    height: 6px;
    border-radius: var(--radius-full);
    appearance: none;
    cursor: pointer;
    /* One step darker than --bg-tertiary so the track stays visible when
       this control sits inside a SettingsCard (also --bg-tertiary). */
    background: var(--bg-secondary);
    accent-color: var(--accent-primary);
  }

  .value-display {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    min-width: 2rem;
    text-align: right;
  }
</style>
