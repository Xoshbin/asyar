<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let confirmation = $state('');
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let canSubmit = $derived(confirmation === 'DISABLE' && !submitting);

  function reset() {
    confirmation = '';
    submitting = false;
    errorMessage = null;
  }

  function cancel() {
    reset();
    isOpen = false;
    onCancel?.();
  }

  async function submit() {
    if (!canSubmit) return;
    submitting = true;
    errorMessage = null;
    try {
      await syncEncryptionService.disable();
      reset();
      isOpen = false;
      onComplete?.();
    } catch (err) {
      logService.warn(`disable dialog submit failed: ${String(err)}`);
      errorMessage = "Couldn't disable encrypted sync. Check your connection and try again.";
      submitting = false;
    }
  }

  function handleEnter() {
    if (canSubmit) submit();
  }
</script>

<Modal bind:isOpen labelledBy="disable-title" onEscape={cancel} onEnter={handleEnter}>
  {#snippet children()}
    <h2 id="disable-title" class="dialog-title danger">Disable encrypted sync</h2>
    <p class="dialog-body primary">
      Disabling encrypted sync will re-upload every item to Asyar's servers in plaintext. Asyar will
      be able to read your synced data again. Continue?
    </p>
    <p class="dialog-body">
      To confirm, type <strong>DISABLE</strong> below.
    </p>
    <Input
      textIntent="exact"
      bind:value={confirmation}
      placeholder="Type DISABLE to confirm"
      autofocus
    />
    {#if errorMessage}
      <p class="text-caption error mt-2">{errorMessage}</p>
    {/if}
    <div class="dialog-actions">
      <Button onclick={cancel}>Cancel</Button>
      <Button class="btn-danger" disabled={!canSubmit} onclick={submit}>
        {submitting ? 'Disabling…' : 'Disable encrypted sync'}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
  .dialog-title {
    font-size: var(--font-size-xl);
    font-weight: 600;
    margin-bottom: var(--space-2);
    font-family: var(--font-ui);
  }

  .dialog-title.danger {
    color: var(--accent-danger);
  }

  .dialog-body {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
    font-family: var(--font-ui);
  }

  .dialog-body.primary {
    color: var(--text-primary);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .text-caption {
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
    color: var(--accent-danger);
  }

  .text-caption.error {
    color: var(--accent-danger);
  }

  .mt-2 {
    margin-top: var(--space-2);
  }

  :global(.btn-danger) {
    background: var(--accent-danger-fill) !important;
    color: var(--text-on-accent) !important;
    border-color: transparent !important;
  }

  :global(.btn-danger:hover:not(:disabled)) {
    opacity: 0.9;
  }

  :global(.btn-danger:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
