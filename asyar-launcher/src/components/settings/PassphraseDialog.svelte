<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';

  let {
    isOpen = $bindable(false),
    title = 'Unlock encrypted sync',
    description = 'Encrypted sync needs your passphrase to continue.',
    onComplete,
    onCancel,
    onForgot,
  }: {
    isOpen?: boolean;
    title?: string;
    description?: string;
    onComplete?: () => void;
    onCancel?: () => void;
    onForgot?: () => void;
  } = $props();

  let passphrase = $state('');
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);

  function reset() {
    passphrase = '';
    submitting = false;
    errorMessage = null;
  }

  function cancel() {
    reset();
    isOpen = false;
    onCancel?.();
  }

  async function submit() {
    if (submitting || passphrase.length === 0) return;
    submitting = true;
    errorMessage = null;
    try {
      await syncEncryptionService.unlock(passphrase);
      reset();
      isOpen = false;
      onComplete?.();
    } catch (err) {
      logService.warn(`passphrase dialog unlock failed: ${String(err)}`);
      errorMessage = 'Incorrect passphrase. Try again.';
      submitting = false;
    }
  }

  function forgot() {
    reset();
    isOpen = false;
    onForgot?.();
  }
</script>

<Modal bind:isOpen labelledBy="passphrase-title" onEscape={cancel} onEnter={submit}>
  {#snippet children()}
    <h2 id="passphrase-title" class="dialog-title">{title}</h2>
    <p class="dialog-body">{description}</p>
    <Input
      type="password"
      placeholder="Passphrase"
      bind:value={passphrase}
      maxlength={256}
      autofocus
    />
    {#if errorMessage}
      <p class="text-caption error mt-2">{errorMessage}</p>
    {/if}
    <div class="dialog-footer">
      {#if onForgot}
        <button type="button" class="text-link" onclick={forgot}>Use recovery phrase instead</button
        >
      {:else}
        <span></span>
      {/if}
      <div class="flex gap-2">
        <Button onclick={cancel}>Cancel</Button>
        <Button
          class="btn-primary"
          disabled={submitting || passphrase.length === 0}
          onclick={submit}
        >
          {submitting ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
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

  .dialog-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--space-4);
  }

  .text-caption {
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
  }

  .text-caption.error {
    color: var(--accent-danger);
  }

  .mt-2 {
    margin-top: var(--space-2);
  }

  .flex {
    display: flex;
  }

  .gap-2 {
    gap: var(--space-2);
  }

  .text-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    text-decoration: underline;
    font-family: var(--font-ui);
  }

  .text-link:hover {
    color: var(--text-primary);
  }
</style>
