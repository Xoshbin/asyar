<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import {
    parsePhraseInput,
    joinPhraseForWire,
  } from './RecoverWithMnemonicDialog.logic';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let stage = $state<'words' | 'passphrase' | 'submitting'>('words');
  let phraseInput = $state('');
  let parsed = $derived(parsePhraseInput(phraseInput));

  let newPass = $state('');
  let confirmNew = $state('');
  let strength = $derived(evaluatePassphraseStrength(newPass));
  let confirmsMatch = $derived(newPass.length > 0 && newPass === confirmNew);
  let submitDisabled = $derived(!strength.accepted || !confirmsMatch || stage === 'submitting');

  let errorMessage = $state<string | null>(null);

  function reset() {
    stage = 'words';
    phraseInput = '';
    newPass = '';
    confirmNew = '';
    errorMessage = null;
  }

  function cancel() {
    reset();
    isOpen = false;
    onCancel?.();
  }

  function continueToPassphrase() {
    if (parsed.isValid) stage = 'passphrase';
  }

  async function submit() {
    if (submitDisabled) return;
    stage = 'submitting';
    errorMessage = null;
    try {
      const phrase = joinPhraseForWire(parsed.words);
      await syncEncryptionService.recoverWithMnemonic(phrase, newPass);
      reset();
      isOpen = false;
      onComplete?.();
    } catch (err) {
      logService.warn(`recover dialog submit failed: ${String(err)}`);
      errorMessage = String(err).includes('match')
        ? "Recovery phrase doesn't match your account. Re-check the words you typed."
        : "Couldn't recover. Check your connection and try again.";
      stage = 'passphrase';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  }
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
      aria-labelledby="recover-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        {#if stage === 'words'}
          <h2 id="recover-title" class="dialog-title">
            Recover with your 24-word phrase
          </h2>
          <p class="dialog-body">
            Paste your recovery phrase below. Words can be separated by spaces or new lines.
          </p>
          <textarea
            class="phrase-textarea"
            bind:value={phraseInput}
            placeholder="abandon ability able about ..."
            rows="5"
            autocomplete="off"
            spellcheck="false"
          ></textarea>
          <div class="phrase-status">
            {#if parsed.words.length === 0}
              <span class="text-caption">0 / 24 words</span>
            {:else if parsed.unknownWords.length > 0}
              <span class="text-caption error">
                Unknown {parsed.unknownWords.length === 1 ? 'word' : 'words'}:
                {parsed.unknownWords.slice(0, 3).join(', ')}{parsed.unknownWords.length > 3 ? '…' : ''}
              </span>
            {:else if parsed.words.length !== 24}
              <span class="text-caption" class:error={parsed.words.length > 24}>
                {parsed.words.length} / 24 words
              </span>
            {:else}
              <span class="text-caption ok">All 24 words look valid.</span>
            {/if}
          </div>
          <div class="dialog-actions">
            <Button onclick={cancel}>Cancel</Button>
            <Button class="btn-primary" disabled={!parsed.isValid} onclick={continueToPassphrase}>
              Continue
            </Button>
          </div>
        {:else if stage === 'passphrase' || stage === 'submitting'}
          <h2 id="recover-title" class="dialog-title">
            Choose a new passphrase
          </h2>
          <p class="dialog-body">
            This passphrase will replace your forgotten one. Your recovery phrase stays the same.
          </p>
          <div class="flex-col">
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
              <p class="text-caption error">Passphrases don't match.</p>
            {/if}
            {#if errorMessage}
              <p class="text-caption error">{errorMessage}</p>
            {/if}
          </div>
          <div class="dialog-actions">
            <Button onclick={() => (stage = 'words')} disabled={stage === 'submitting'}>Back</Button>
            <Button class="btn-primary" disabled={submitDisabled} onclick={submit}>
              {stage === 'submitting' ? 'Recovering…' : 'Recover'}
            </Button>
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

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .phrase-textarea {
    width: 100%;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    resize: vertical;
    outline: none;
  }

  .phrase-textarea:focus {
    border-color: var(--accent);
  }

  .phrase-status {
    margin-top: var(--space-2);
    min-height: 1.25rem;
  }

  .flex-col {
    display: flex;
    flex-direction: column;
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

  .text-caption.ok {
    color: var(--accent-success);
  }
</style>
