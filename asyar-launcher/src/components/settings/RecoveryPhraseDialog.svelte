<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import { Button, Input, Checkbox } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let stage = $state<'passphrase' | 'submitting' | 'phrase'>('passphrase');
  let passphrase = $state('');
  let recoveryPhrase = $state('');
  let savedConfirmed = $state(false);
  let copied = $state(false);
  let errorMessage = $state<string | null>(null);
  let passphraseInput = $state<HTMLInputElement | null>(null);

  function reset() {
    stage = 'passphrase';
    passphrase = '';
    recoveryPhrase = '';
    savedConfirmed = false;
    copied = false;
    errorMessage = null;
  }

  function cancel() {
    reset();
    isOpen = false;
    onCancel?.();
  }

  async function submit() {
    if (passphrase.length === 0) return;
    stage = 'submitting';
    errorMessage = null;
    try {
      recoveryPhrase = await syncEncryptionService.showRecoveryPhrase(passphrase);
      stage = 'phrase';
    } catch (err) {
      logService.warn(`recovery phrase dialog failed: ${String(err)}`);
      errorMessage = 'Incorrect passphrase. Try again.';
      stage = 'passphrase';
    }
  }

  function handleEnter() {
    if (stage === 'passphrase' && passphrase.length > 0) submit();
  }

  async function copyPhrase() {
    try {
      await navigator.clipboard.writeText(recoveryPhrase);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (err) {
      logService.warn(`copy recovery phrase failed: ${String(err)}`);
    }
  }

  function finish() {
    reset();
    isOpen = false;
    onComplete?.();
  }

  $effect(() => {
    if (stage === 'passphrase' && passphraseInput) {
      queueMicrotask(() => passphraseInput?.focus());
    }
  });
</script>

<Modal bind:isOpen labelledBy="phrase-title" width="32rem" onEscape={cancel} onEnter={handleEnter}>
  {#snippet children()}
    {#if stage === 'passphrase' || stage === 'submitting'}
      <h2 id="phrase-title" class="dialog-title">View recovery phrase</h2>
      <p class="dialog-body">Enter your current passphrase to view your 24-word recovery phrase.</p>
      <Input
        type="password"
        placeholder="Passphrase"
        bind:value={passphrase}
        bind:ref={passphraseInput}
        maxlength={256}
      />
      {#if errorMessage}
        <p class="text-caption error mt-2">{errorMessage}</p>
      {/if}
      <div class="dialog-actions">
        <Button onclick={cancel}>Cancel</Button>
        <Button
          class="btn-primary"
          disabled={passphrase.length === 0 || stage === 'submitting'}
          onclick={submit}
        >
          {stage === 'submitting' ? 'Verifying…' : 'View'}
        </Button>
      </div>
    {:else if stage === 'phrase'}
      <h2 id="phrase-title" class="dialog-title">Your recovery phrase</h2>
      <p class="dialog-body">
        Save these 24 words somewhere safe — a password manager, encrypted note, or paper. If you
        forget your passphrase, this is the only way to get your data back.
      </p>
      <div class="phrase-blob">{recoveryPhrase}</div>
      <div class="phrase-actions-row">
        <Button onclick={copyPhrase}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <label class="written-down-label">
        <Checkbox checked={savedConfirmed} onchange={(v) => (savedConfirmed = v)} />
        <span class="dialog-body-inline">I've saved this somewhere safe.</span>
      </label>
      <div class="dialog-actions">
        <Button class="btn-primary" disabled={!savedConfirmed} onclick={finish}>Done</Button>
      </div>
    {/if}
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

  .dialog-body-inline {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .phrase-blob {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    user-select: text;
    word-spacing: 0.25em;
    margin-bottom: var(--space-2);
  }

  .phrase-actions-row {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-3);
  }

  .written-down-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
    cursor: pointer;
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
</style>
