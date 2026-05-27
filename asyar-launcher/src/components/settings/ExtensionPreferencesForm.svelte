<script lang="ts">
  import Input from '../base/Input.svelte';
  import Checkbox from '../base/Checkbox.svelte';
  import Select from '../base/Select.svelte';
  import SettingsFormRow from './SettingsFormRow.svelte';
  import type { PreferenceDeclaration } from 'asyar-sdk/contracts';

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

  function dropdownValue(pref: PreferenceDeclaration): string {
    const v = values[pref.name];
    if (typeof v === 'string') return v;
    if (typeof pref.default === 'string') return pref.default;
    return pref.data?.[0]?.value ?? '';
  }

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
            <Select
              value={dropdownValue(pref)}
              options={dropdownOptions(pref)}
              {disabled}
              onchange={(v) => handleValueChange(pref.name, v)}
            />
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

</style>
