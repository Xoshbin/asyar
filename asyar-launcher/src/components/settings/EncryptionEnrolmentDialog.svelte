<script lang="ts">
  import { t } from '../../services/i18n';
  import Modal from '../base/Modal.svelte';
  import { Button, Input, Checkbox } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import { logService } from '../../services/log/logService';

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
      errorMessage = t('settings.e2ee.enrol_error');
      stage = 'passphrase';
    }
  }

  function handleEnter() {
    if (stage === 'passphrase' && !submitDisabled) submitPassphrase();
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

  $effect(() => {
    if (stage === 'passphrase' && pass1Input) {
      queueMicrotask(() => pass1Input?.focus());
    }
  });
</script>

<Modal bind:isOpen labelledBy="enrol-title" width="32rem" onEscape={cancel} onEnter={handleEnter}>
  {#snippet children()}
    {#if stage === 'passphrase' || stage === 'submitting'}
      <h2 id="enrol-title" class="dialog-title">{t('settings.e2ee.enrol_title')}</h2>
      <p class="dialog-body">{t('settings.e2ee.enrol_body')}</p>
      <div class="flex flex-col gap-3">
        <Input
          textIntent="exact"
          type="password"
          placeholder={t('settings.e2ee.enrol_passphrase_placeholder')}
          bind:value={pass1}
          bind:ref={pass1Input}
          maxlength={256}
        />
        <Input
          textIntent="exact"
          type="password"
          placeholder={t('settings.e2ee.enrol_confirm_placeholder')}
          bind:value={pass2}
          maxlength={256}
        />
        {#if pass1.length > 0}
          <p class="text-caption" class:error={!strength.accepted}>
            {t('settings.e2ee.strength', { score: strength.score })}{#if strength.reason}
              — {strength.reason}{/if}
          </p>
        {/if}
        {#if pass2.length > 0 && !confirmsMatch}
          <p class="text-caption error">{t('settings.e2ee.passphrases_mismatch')}</p>
        {/if}
        {#if errorMessage}
          <p class="text-caption error">{errorMessage}</p>
        {/if}
      </div>
      <div class="dialog-actions">
        <Button onclick={cancel}>{t('common.cancel')}</Button>
        <Button class="btn-primary" disabled={submitDisabled} onclick={submitPassphrase}>
          {stage === 'submitting' ? t('settings.e2ee.setting_up') : t('common.continue')}
        </Button>
      </div>
    {:else if stage === 'phrase'}
      <h2 id="enrol-title" class="dialog-title">{t('settings.e2ee.phrase_title')}</h2>
      <p class="dialog-body">
        {t('settings.e2ee.phrase_body_enrol')}
      </p>
      <div class="phrase-blob">{recoveryPhrase}</div>
      <div class="phrase-actions-row">
        <Button onclick={copyPhrase}>
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
      <label class="written-down-label">
        <Checkbox checked={savedConfirmed} onchange={(v) => (savedConfirmed = v)} />
        <span class="dialog-body">{t('settings.e2ee.saved_confirm')}</span>
      </label>
      <div class="dialog-actions">
        <Button class="btn-primary" disabled={!savedConfirmed} onclick={finish}
          >{t('common.done')}</Button
        >
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
