<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import {
    isValidBip39Word,
    autocompleteSuggestions,
    normalizePhraseInput,
    isComplete24Words,
  } from './RecoverWithMnemonicDialog.logic';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let stage = $state<'words' | 'passphrase' | 'submitting'>('words');
  let words = $state<string[]>(Array.from({ length: 24 }, () => ''));
  let allValid = $derived(isComplete24Words(words) && words.every((w) => isValidBip39Word(w)));

  let newPass = $state('');
  let confirmNew = $state('');
  let strength = $derived(evaluatePassphraseStrength(newPass));
  let confirmsMatch = $derived(newPass.length > 0 && newPass === confirmNew);
  let submitDisabled = $derived(!strength.accepted || !confirmsMatch || stage === 'submitting');

  let errorMessage = $state<string | null>(null);

  function reset() {
    stage = 'words';
    words = Array.from({ length: 24 }, () => '');
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
    if (allValid) stage = 'passphrase';
  }

  async function submit() {
    if (submitDisabled) return;
    stage = 'submitting';
    errorMessage = null;
    try {
      const phrase = normalizePhraseInput(words);
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

  function suggestionsFor(i: number): readonly string[] {
    return autocompleteSuggestions(words[i] ?? '', 4);
  }

  function applySuggestion(i: number, word: string) {
    words[i] = word;
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 dialog-backdrop flex items-center justify-center z-[200]"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && cancel()}
    transition:fadeIn={{ duration: 150 }}
  >
    <div
      class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-2xl overflow-hidden"
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
            Type the 24 words from your recovery phrase. Asyar will verify they match your account before changing anything.
          </p>
          <div class="word-grid">
            {#each words as _, i}
              <div class="word-cell">
                <label class="word-label">
                  <span class="word-num">{i + 1}.</span>
                  <input
                    class="word-input"
                    bind:value={words[i]}
                    autocomplete="off"
                    spellcheck="false"
                  />
                </label>
                {#if words[i].length >= 2 && !isValidBip39Word(words[i])}
                  <div class="word-suggestions">
                    {#each suggestionsFor(i) as s}
                      <button type="button" class="word-suggestion" onclick={() => applySuggestion(i, s)}>{s}</button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="dialog-actions">
            <Button onclick={cancel}>Cancel</Button>
            <Button class="btn-primary" disabled={!allValid} onclick={continueToPassphrase}>Continue</Button>
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

  .word-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .word-cell {
    position: relative;
  }

  .word-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    cursor: text;
  }

  .word-num {
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    flex-shrink: 0;
    width: 1.5rem;
    font-family: var(--font-ui);
  }

  .word-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
  }

  .word-suggestions {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-1);
    flex-wrap: wrap;
  }

  .word-suggestion {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-xs);
    padding: var(--space-1);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .word-suggestion:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
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


</style>
