<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let confirmation = $state('');
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let canSubmit = $derived(confirmation === 'DISABLE' && !submitting);
  let confirmationInput = $state<HTMLInputElement | null>(null);

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

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === 'Enter' && canSubmit) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit();
    }
  }
  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
    queueMicrotask(() => confirmationInput?.focus());
  });
  onDestroy(() => window.removeEventListener('keydown', handleKeydown, true));
</script>

{#if isOpen}
  <div
    class="fixed inset-0 dialog-backdrop flex items-center justify-center z-[200]"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && cancel()}
    transition:fadeIn={{ duration: 150 }}
  >
    <div
      class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-md overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        <h2 id="disable-title" class="dialog-title danger">
          Disable encrypted sync
        </h2>
        <p class="dialog-body primary">
          Disabling encrypted sync will re-upload every item to Asyar's servers in plaintext. Asyar will be able to read your synced data again. Continue?
        </p>
        <p class="dialog-body">
          To confirm, type <strong>DISABLE</strong> below.
        </p>
        <Input bind:value={confirmation} bind:ref={confirmationInput} placeholder="Type DISABLE to confirm" />
        {#if errorMessage}
          <p class="text-caption error mt-2">{errorMessage}</p>
        {/if}
        <div class="dialog-actions">
          <Button onclick={cancel}>Cancel</Button>
          <Button class="btn-danger" disabled={!canSubmit} onclick={submit}>
            {submitting ? 'Disabling…' : 'Disable encrypted sync'}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
  }

  :global(html[data-platform="linux"]) .dialog-backdrop {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.6);
  }

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
    background: var(--accent-danger) !important;
    color: white !important;
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
