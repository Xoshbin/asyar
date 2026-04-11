<script lang="ts">
  import Input from '../base/Input.svelte';
  import Checkbox from '../base/Checkbox.svelte';
  import SettingsFormRow from './SettingsFormRow.svelte';
  import type { PreferenceDeclaration } from 'asyar-sdk';

  interface Props {
    preferences: PreferenceDeclaration[];
    values: Record<string, any>;
    errors?: Record<string, string>;
    disabled?: boolean;
    onChange: (name: string, value: any) => void;
  }

  let {
    preferences,
    values = {},
    errors = {},
    disabled = false,
    onChange,
  }: Props = $props();

  function handleValueChange(name: string, value: any) {
    if (disabled) return;
    onChange(name, value);
  }

  function handleText(pref: PreferenceDeclaration, e: Event) {
    handleValueChange(pref.name, (e.target as HTMLInputElement).value);
  }

  function handleNumber(pref: PreferenceDeclaration, e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    handleValueChange(pref.name, raw === '' ? undefined : Number(raw));
  }

  // Dropdown: SegmentedControl uses $bindable value. Use a local setter
  // function per-pref that wraps the current value and forwards mutations
  // to the parent via onChange.
  function dropdownValue(pref: PreferenceDeclaration): string {
    const v = values[pref.name];
    if (typeof v === 'string') return v;
    if (typeof pref.default === 'string') return pref.default;
    return pref.data?.[0]?.value ?? '';
  }

  function onDropdownClick(pref: PreferenceDeclaration, optionValue: string) {
    handleValueChange(pref.name, optionValue);
  }

  // Minimal dropdown-options shape for SegmentedControl, mapped from the
  // manifest's `data` array.
  function dropdownOptions(pref: PreferenceDeclaration) {
    return (pref.data ?? []).map((d) => ({ value: d.value, label: d.title }));
  }
</script>

<div class="extension-preferences-form">
  {#each preferences as pref (pref.name)}
    <SettingsFormRow label={pref.title} description={pref.description ?? ''}>
      <div class="control-wrapper">
        {#if pref.type === 'textfield'}
          <Input
            value={values[pref.name] ?? ''}
            placeholder={pref.placeholder ?? ''}
            {disabled}
            oninput={(e: Event) => handleText(pref, e)}
          />
        {:else if pref.type === 'password'}
          <Input
            value={values[pref.name] ?? ''}
            type="password"
            placeholder={pref.placeholder ?? ''}
            {disabled}
            oninput={(e: Event) => handleText(pref, e)}
          />
        {:else if pref.type === 'number'}
          <Input
            value={values[pref.name] ?? ''}
            type="number"
            placeholder={pref.placeholder ?? ''}
            {disabled}
            oninput={(e: Event) => handleNumber(pref, e)}
          />
        {:else if pref.type === 'checkbox'}
          <Checkbox
            checked={!!values[pref.name]}
            {disabled}
            onchange={(checked: boolean) => handleValueChange(pref.name, checked)}
          />
        {:else if pref.type === 'dropdown'}
          {#if pref.data && pref.data.length > 0}
            <div class="dropdown-wrap" role="radiogroup" aria-label={pref.title}>
              {#each dropdownOptions(pref) as opt (opt.value)}
                <button
                  type="button"
                  class="dropdown-btn"
                  class:active={dropdownValue(pref) === opt.value}
                  aria-checked={dropdownValue(pref) === opt.value}
                  role="radio"
                  {disabled}
                  onclick={() => onDropdownClick(pref, opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          {:else}
            <div class="error-inline">Invalid dropdown configuration</div>
          {/if}
        {:else if pref.type === 'appPicker' || pref.type === 'file' || pref.type === 'directory'}
          <Input
            type="text"
            value={values[pref.name] ?? ''}
            placeholder={pref.type === 'appPicker'
              ? 'Application path'
              : pref.type === 'directory'
              ? 'Directory path'
              : 'File path'}
            {disabled}
            oninput={(e: Event) => handleText(pref, e)}
          />
        {:else}
          <div class="error-inline">Unknown type: {pref.type}</div>
        {/if}

        {#if errors[pref.name]}
          <div class="error-inline" role="alert">{errors[pref.name]}</div>
        {/if}
      </div>
    </SettingsFormRow>
  {/each}
</div>

<style>
  .extension-preferences-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .control-wrapper {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .error-inline {
    color: var(--color-danger, #c33);
    font-size: 0.75rem;
    font-family: var(--font-ui);
  }

  .dropdown-wrap {
    display: flex;
    gap: 3px;
    padding: 3px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary-full-opacity);
  }

  .dropdown-btn {
    flex: 1;
    padding: 5px 10px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
    outline: none;
    transition: color var(--transition-fast);
  }

  .dropdown-btn:hover:not(.active):not(:disabled) {
    color: var(--text-secondary);
  }

  .dropdown-btn.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
  }

  .dropdown-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
