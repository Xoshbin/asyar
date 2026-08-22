<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';

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

  function handleEnter() {
    if (!submitDisabled) submit();
  }
</script>

<Modal bind:isOpen labelledBy="rotate-title" onEscape={cancel} onEnter={handleEnter}>
  {#snippet children()}
    <h2 id="rotate-title" class="dialog-title">Change passphrase</h2>
    <p class="dialog-body">
      Your recovery phrase will not change — only the passphrase used to unlock encrypted sync.
    </p>
    <div class="flex-col gap-3">
      <div class="input-gap">
        <Input
          textIntent="exact"
          type="password"
          placeholder={t('common.current_passphrase')}
          bind:value={oldPass}
          maxlength={256}
          autofocus
        />
      </div>
      <div class="input-gap">
        <Input
          textIntent="exact"
          type="password"
          placeholder={t('common.new_passphrase')}
          bind:value={newPass}
          maxlength={256}
        />
      </div>
      <div class="input-gap">
        <Input
          textIntent="exact"
          type="password"
          placeholder={t('common.confirm_new_passphrase')}
          bind:value={confirmNew}
          maxlength={256}
        />
      </div>
      {#if newPass.length > 0}
        <p class="text-caption" class:error={!strength.accepted}>
          Strength {strength.score}/4{#if strength.reason}
            — {strength.reason}{/if}
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
      <Button onclick={cancel}>{t('common.cancel')}</Button>
      <Button class="btn-primary" disabled={submitDisabled} onclick={submit}>
        {submitting ? 'Changing…' : 'Change passphrase'}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
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
