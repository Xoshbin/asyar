<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input, Checkbox } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

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

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === 'Enter' && stage === 'passphrase' && passphrase.length > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit();
    }
  }
  $effect(() => {
    if (stage === 'passphrase' && passphraseInput) {
      queueMicrotask(() => passphraseInput?.focus());
    }
  });
  onMount(() => window.addEventListener('keydown', handleKeydown, true));
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
      class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-lg overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="phrase-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        {#if stage === 'passphrase' || stage === 'submitting'}
          <h2 id="phrase-title" class="dialog-title">View recovery phrase</h2>
          <p class="dialog-body">
            Enter your current passphrase to view your 24-word recovery phrase.
          </p>
          <Input type="password" placeholder="Passphrase" bind:value={passphrase} bind:ref={passphraseInput} maxlength={256} />
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
            Save these 24 words somewhere safe — a password manager, encrypted note, or paper.
            If you forget your passphrase, this is the only way to get your data back.
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
