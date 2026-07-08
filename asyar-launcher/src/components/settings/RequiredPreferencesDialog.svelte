<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import { Button } from '../index';
  import type { PreferenceDeclaration } from 'asyar-sdk/contracts';
  import ExtensionPreferencesForm from './ExtensionPreferencesForm.svelte';

  interface Props {
    extensionId: string;
    commandId: string;
    missing: PreferenceDeclaration[];
    onSave: (values: Record<string, unknown>) => void | Promise<void>;
    onCancel: () => void;
  }

  let { extensionId, commandId, missing, onSave, onCancel }: Props = $props();

  // Local working copy of the values the user types in. Committed to the
  // preferences service only when they click Save & Continue.
  let values = $state<Record<string, unknown>>({});
  let isSaving = $state(false);

  // "Complete" when every required pref has a non-empty value. Empty-string
  // and undefined both count as missing; booleans (checkbox) are allowed to
  // be `false`.
  const isComplete = $derived(
    missing.every((p) => {
      const v = values[p.name];
      if (p.type === 'checkbox') return typeof v === 'boolean';
      if (p.type === 'number') return typeof v === 'number' && Number.isFinite(v);
      return v !== undefined && v !== null && v !== '';
    }),
  );

  function handleChange(key: string, value: unknown) {
    values = { ...values, [key]: value };
  }

  async function handleSave() {
    if (!isComplete || isSaving) return;
    isSaving = true;
    try {
      await onSave(values);
    } finally {
      isSaving = false;
    }
  }

  function handleCancel() {
    if (!isSaving) onCancel();
  }
</script>

<Modal
  isOpen={true}
  labelledBy="required-prefs-title"
  width="440px"
  onEscape={handleCancel}
  onEnter={handleSave}
>
  {#snippet children()}
    <h2 id="required-prefs-title" class="modal-title">Extension requires setup</h2>
    <p class="modal-subtitle">
      Fill in the required preferences for <strong>{extensionId}</strong>
      to run <strong>{commandId}</strong>.
    </p>

    <div class="modal-form">
      <ExtensionPreferencesForm
        preferences={missing}
        {values}
        errors={{}}
        disabled={isSaving}
        onChange={handleChange}
      />
    </div>
  {/snippet}
  {#snippet actions()}
    <Button disabled={isSaving} onclick={handleCancel}>Cancel</Button>
    <Button class="btn-primary" disabled={!isComplete || isSaving} onclick={handleSave}>
      {isSaving ? 'Saving…' : 'Save & Continue'}
    </Button>
  {/snippet}
</Modal>

<style>
  .modal-title {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .modal-subtitle {
    margin: 0 0 var(--space-4) 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    font-family: var(--font-ui);
  }

  .modal-form {
    margin-bottom: var(--space-4);
  }
</style>
