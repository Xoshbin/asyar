<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input, Checkbox } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { pickWordVerificationIndices, shuffleAndSplitPhrase } from './EncryptionEnrolmentDialog.logic';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: { isOpen?: boolean; onComplete?: () => void; onCancel?: () => void } = $props();

  let stage = $state<'passphrase' | 'submitting' | 'phrase' | 'verify'>('passphrase');
  let passphrase = $state('');
  let recoveryPhrase = $state('');
  let phraseWords = $derived(shuffleAndSplitPhrase(recoveryPhrase));
  let writtenDown = $state(false);
  let errorMessage = $state<string | null>(null);
  let passphraseInput = $state<HTMLInputElement | null>(null);

  let verifyIndices = $state<readonly [number, number, number] | null>(null);
  let verifyAnswers = $state<[string, string, string]>(['', '', '']);
  let verifyOk = $derived(
    verifyIndices !== null &&
      verifyIndices.every(
        (idx, i) =>
          verifyAnswers[i].trim().toLowerCase() === (phraseWords[idx] ?? '').toLowerCase(),
      ),
  );

  function reset() {
    stage = 'passphrase';
    passphrase = '';
    recoveryPhrase = '';
    writtenDown = false;
    verifyIndices = null;
    verifyAnswers = ['', '', ''];
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

  function startVerify() {
    verifyIndices = pickWordVerificationIndices();
    stage = 'verify';
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
            Write these 24 words down somewhere safe. If you forget your passphrase, this is the only way to get your data back.
          </p>
          <div class="phrase-grid">
            {#each phraseWords as w, i}
              <div class="phrase-word">
                <span class="phrase-index">{i + 1}.</span>
                <span class="phrase-text">{w}</span>
              </div>
            {/each}
          </div>
          <label class="written-down-label">
            <Checkbox checked={writtenDown} onchange={(v) => (writtenDown = v)} />
            <span class="dialog-body-inline">I have written this down.</span>
          </label>
          <div class="dialog-actions">
            <Button class="btn-primary" disabled={!writtenDown} onclick={startVerify}>Continue</Button>
          </div>
        {:else if stage === 'verify'}
          <h2 id="phrase-title" class="text-xl font-semibold mb-2 text-[var(--text-primary)]">
            Confirm you've written it down
          </h2>
          <p class="text-body mb-4 text-[var(--text-secondary)]">
            Type the requested words to confirm:
          </p>
          <div class="flex flex-col gap-3">
            {#each verifyIndices ?? [] as idx, i}
              <div class="flex items-center gap-2">
                <span class="text-body w-20 text-[var(--text-secondary)]">Word #{idx + 1}</span>
                <Input bind:value={verifyAnswers[i]} placeholder="" />
              </div>
            {/each}
          </div>
          <div class="flex justify-end gap-2 mt-4">
            <Button onclick={() => (stage = 'phrase')}>Back</Button>
            <Button class="btn-primary" disabled={!verifyOk} onclick={finish}>Done</Button>
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

  .phrase-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .phrase-word {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    font-family: var(--font-mono);
  }

  .phrase-index {
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    flex-shrink: 0;
  }

  .phrase-text {
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .written-down-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
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
