<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input, Checkbox } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

  let {
    isOpen = $bindable(false),
    onComplete,
    onCancel,
  }: {
    isOpen?: boolean;
    onComplete?: () => void;
    onCancel?: () => void;
  } = $props();

  let stage = $state<'passphrase' | 'submitting' | 'phrase'>('passphrase');
  let pass1 = $state('');
  let pass2 = $state('');
  let pass1Input = $state<HTMLInputElement | null>(null);
  let strength = $derived(evaluatePassphraseStrength(pass1));
  let confirmsMatch = $derived(pass1.length > 0 && pass1 === pass2);
  let submitDisabled = $derived(!strength.accepted || !confirmsMatch || stage === 'submitting');

  let recoveryPhrase = $state('');
  let savedConfirmed = $state(false);
  let copied = $state(false);

  let errorMessage = $state<string | null>(null);

  function reset() {
    stage = 'passphrase';
    pass1 = '';
    pass2 = '';
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

  async function submitPassphrase() {
    if (submitDisabled) return;
    stage = 'submitting';
    errorMessage = null;
    try {
      recoveryPhrase = await syncEncryptionService.enrol(pass1);
      stage = 'phrase';
    } catch (err) {
      logService.warn(`enrolment dialog submit failed: ${String(err)}`);
      errorMessage = "Couldn't enable encrypted sync. Check your connection and try again.";
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
    isOpen = false;
    onComplete?.();
    // Reset AFTER closing so the parent's $effect doesn't show empty form for a frame.
    queueMicrotask(reset);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === 'Enter' && stage === 'passphrase' && !submitDisabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitPassphrase();
    }
  }
  $effect(() => {
    if (stage === 'passphrase' && pass1Input) {
      queueMicrotask(() => pass1Input?.focus());
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
      aria-labelledby="enrol-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        {#if stage === 'passphrase' || stage === 'submitting'}
          <h2 id="enrol-title" class="dialog-title">
            Set up encrypted sync
          </h2>
          <p class="dialog-body">
            Choose a passphrase. You'll need this on every other device. Asyar cannot reset it for you.
          </p>
          <div class="flex flex-col gap-3">
            <Input type="password" placeholder="Passphrase (12+ characters)" bind:value={pass1} bind:ref={pass1Input} maxlength={256} />
            <Input type="password" placeholder="Confirm passphrase" bind:value={pass2} maxlength={256} />
            {#if pass1.length > 0}
              <p class="text-caption" class:error={!strength.accepted}>
                Strength {strength.score}/4{#if strength.reason} — {strength.reason}{/if}
              </p>
            {/if}
            {#if pass2.length > 0 && !confirmsMatch}
              <p class="text-caption error">Passphrases don't match.</p>
            {/if}
            {#if errorMessage}
              <p class="text-caption error">{errorMessage}</p>
            {/if}
          </div>
          <div class="dialog-actions">
            <Button onclick={cancel}>Cancel</Button>
            <Button class="btn-primary" disabled={submitDisabled} onclick={submitPassphrase}>
              {stage === 'submitting' ? 'Setting up…' : 'Continue'}
            </Button>
          </div>
        {:else if stage === 'phrase'}
          <h2 id="enrol-title" class="dialog-title">
            Your recovery phrase
          </h2>
          <p class="dialog-body">
            Save these 24 words somewhere safe — a password manager, encrypted note, or paper.
            If you forget your passphrase, this is the only way to recover your data.
          </p>
          <div class="phrase-blob">{recoveryPhrase}</div>
          <div class="phrase-actions-row">
            <Button onclick={copyPhrase}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <label class="written-down-label">
            <Checkbox checked={savedConfirmed} onchange={(v) => (savedConfirmed = v)} />
            <span class="dialog-body">I've saved this somewhere safe.</span>
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
    color: var(--text-secondary);
    font-family: var(--font-ui);
  }

  .text-caption.error {
    color: var(--accent-danger);
  }
</style>
