<script lang="ts">
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
    })
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
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Required Preferences">
  <div class="modal-content">
    <h2 class="modal-title">Extension requires setup</h2>
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

    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" disabled={isSaving} onclick={onCancel}>
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!isComplete || isSaving}
        onclick={handleSave}
      >
        {isSaving ? 'Saving…' : 'Save & Continue'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--bg-primary, #fff);
    color: var(--text-primary);
    border-radius: var(--radius-md, 8px);
    padding: var(--space-6, 1.5rem);
    min-width: 440px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    font-family: var(--font-ui);
  }

  .modal-title {
    margin: 0 0 var(--space-2, 0.5rem) 0;
    font-size: var(--font-size-lg, 1.1rem);
    font-weight: 600;
  }

  .modal-subtitle {
    margin: 0 0 var(--space-4, 1rem) 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .modal-form {
    margin-bottom: var(--space-4, 1rem);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2, 0.5rem);
  }

  .btn {
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
    font-family: var(--font-ui);
    border: 1px solid var(--border-color);
    cursor: pointer;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .btn-primary {
    background: var(--accent, #3b82f6);
    color: #fff;
    border-color: transparent;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
