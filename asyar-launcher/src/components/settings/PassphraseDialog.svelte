<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';
  import { fadeIn, popupScale } from '$lib/transitions';

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
  let passphraseInput = $state<HTMLInputElement | null>(null);

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

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (event.key === 'Enter' && !submitting) {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit();
    }
  }
  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
    queueMicrotask(() => passphraseInput?.focus());
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
      aria-labelledby="passphrase-title"
      transition:popupScale={{ duration: 120 }}
    >
      <div class="p-6">
        <h2 id="passphrase-title" class="dialog-title">{title}</h2>
        <p class="dialog-body">{description}</p>
        <Input type="password" placeholder="Passphrase" bind:value={passphrase} bind:ref={passphraseInput} maxlength={256} />
        {#if errorMessage}
          <p class="text-caption error mt-2">{errorMessage}</p>
        {/if}
        <div class="dialog-footer">
          {#if onForgot}
            <button type="button" class="text-link" onclick={forgot}>Use recovery phrase instead</button>
          {:else}
            <span></span>
          {/if}
          <div class="flex gap-2">
            <Button onclick={cancel}>Cancel</Button>
            <Button class="btn-primary" disabled={submitting || passphrase.length === 0} onclick={submit}>
              {submitting ? 'Unlocking…' : 'Unlock'}
            </Button>
          </div>
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
