<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let oldPass = $state('');
  let newPass = $state('');
  let confirmNew = $state('');
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let oldPassInput = $state<HTMLInputElement | null>(null);

  let strength = $derived(evaluatePassphraseStrength(newPass));
  let confirmsMatch = $derived(newPass.length > 0 && newPass === confirmNew);
  let submitDisabled = $derived(
    submitting || oldPass.length === 0 || !strength.accepted || !confirmsMatch,
  );

  function reset() {
    oldPass = '';
    newPass = '';
    confirmNew = '';
    submitting = false;
    errorMessage = null;
  }

  function cancel() {
    reset();
    isOpen = false;
    onCancel?.();
  }

  async function submit() {
    if (submitDisabled) return;
    submitting = true;
    errorMessage = null;
    try {
      await syncEncryptionService.rotate(oldPass, newPass);
      reset();
      isOpen = false;
      onComplete?.();
    } catch (err) {
      logService.warn(`rotate dialog submit failed: ${String(err)}`);
      errorMessage = "Couldn't change passphrase. Check the old passphrase and try again.";
      submitting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === 'Enter' && !submitDisabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit();
    }
  }
  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
    queueMicrotask(() => oldPassInput?.focus());
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
      aria-labelledby="rotate-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        <h2 id="rotate-title" class="dialog-title">Change passphrase</h2>
        <p class="dialog-body">
          Your recovery phrase will not change — only the passphrase used to unlock encrypted sync.
        </p>
        <div class="flex-col gap-3">
          <div class="input-gap">
            <Input type="password" placeholder="Current passphrase" bind:value={oldPass} bind:ref={oldPassInput} maxlength={256} />
          </div>
          <div class="input-gap">
            <Input type="password" placeholder="New passphrase (12+ characters)" bind:value={newPass} maxlength={256} />
          </div>
          <div class="input-gap">
            <Input type="password" placeholder="Confirm new passphrase" bind:value={confirmNew} maxlength={256} />
          </div>
          {#if newPass.length > 0}
            <p class="text-caption" class:error={!strength.accepted}>
              Strength {strength.score}/4{#if strength.reason} — {strength.reason}{/if}
            </p>
          {/if}
          {#if confirmNew.length > 0 && !confirmsMatch}
            <p class="text-caption error">New passphrases don't match.</p>
          {/if}
          {#if errorMessage}
            <p class="text-caption error">{errorMessage}</p>
          {/if}
        </div>
        <div class="dialog-actions">
          <Button onclick={cancel}>Cancel</Button>
          <Button class="btn-primary" disabled={submitDisabled} onclick={submit}>
            {submitting ? 'Changing…' : 'Change passphrase'}
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
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .dialog-body {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-4);
    font-family: var(--font-ui);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .flex-col {
    display: flex;
    flex-direction: column;
  }

  .gap-3 {
    gap: var(--space-3);
  }

  .input-gap {
    margin-bottom: var(--space-3);
  }

  .text-caption {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
  }

  .text-caption.error {
    color: var(--accent-danger);
  }


</style>
