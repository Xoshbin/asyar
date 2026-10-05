<script lang="ts">
  import { t } from '../../services/i18n';
  import { Textarea } from '..';
  import Modal from '../base/Modal.svelte';
  import { Button, Input } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { evaluatePassphraseStrength } from './EncryptionEnrolmentDialog.logic';
  import { parsePhraseInput, joinPhraseForWire } from './RecoverWithMnemonicDialog.logic';
  import { logService } from '../../services/log/logService';

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
        ? t('settings.e2ee.recover_mismatch_error')
        : t('settings.e2ee.recover_error');
      stage = 'passphrase';
    }
  }

  function handleEnter() {
    // 'words' stage deliberately has no Enter action: focus is normally in
    // the multi-line textarea (Enter must insert a newline, not submit), and
    // there's no dedicated re-focus/autofocus target on the passphrase
    // fields for entering this stage via "Continue" — matches this dialog's
    // pre-existing behavior of requiring an explicit click there.
    if (stage === 'passphrase' && !submitDisabled) submit();
  }
</script>

<Modal bind:isOpen labelledBy="recover-title" width="32rem" onEscape={cancel} onEnter={handleEnter}>
  {#snippet children()}
    {#if stage === 'words'}
      <h2 id="recover-title" class="dialog-title">{t('settings.e2ee.recover_title')}</h2>
      <p class="dialog-body">
        {t('settings.e2ee.recover_body')}
      </p>
      <Textarea
        unstyled
        textIntent="exact"
        class="phrase-textarea"
        bind:value={phraseInput}
        placeholder="abandon ability able about ..."
        rows="5"
        autocomplete="off"
        autofocus
      ></Textarea>
      <div class="phrase-status">
        {#if parsed.words.length === 0}
          <span class="text-caption">{t('settings.e2ee.words_count', { count: 0 })}</span>
        {:else if parsed.unknownWords.length > 0}
          <span class="text-caption error">
            {t(
              parsed.unknownWords.length === 1
                ? 'settings.e2ee.unknown_word'
                : 'settings.e2ee.unknown_words',
              {
                words:
                  parsed.unknownWords.slice(0, 3).join(', ') +
                  (parsed.unknownWords.length > 3 ? '…' : ''),
              },
            )}
          </span>
        {:else if parsed.words.length !== 24}
          <span class="text-caption" class:error={parsed.words.length > 24}>
            {t('settings.e2ee.words_count', { count: parsed.words.length })}
          </span>
        {:else}
          <span class="text-caption ok">{t('settings.e2ee.all_words_valid')}</span>
        {/if}
      </div>
      <div class="dialog-actions">
        <Button onclick={cancel}>{t('common.cancel')}</Button>
        <Button class="btn-primary" disabled={!parsed.isValid} onclick={continueToPassphrase}>
          {t('common.continue')}
        </Button>
      </div>
    {:else if stage === 'passphrase' || stage === 'submitting'}
      <h2 id="recover-title" class="dialog-title">{t('settings.e2ee.new_passphrase_title')}</h2>
      <p class="dialog-body">
        {t('settings.e2ee.new_passphrase_body')}
      </p>
      <div class="flex-col">
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
            {t('settings.e2ee.strength', { score: strength.score })}{#if strength.reason}
              — {strength.reason}{/if}
          </p>
        {/if}
        {#if confirmNew.length > 0 && !confirmsMatch}
          <p class="text-caption error">{t('settings.e2ee.passphrases_mismatch')}</p>
        {/if}
        {#if errorMessage}
          <p class="text-caption error">{errorMessage}</p>
        {/if}
      </div>
      <div class="dialog-actions">
        <Button onclick={() => (stage = 'words')} disabled={stage === 'submitting'}
          >{t('common.back')}</Button
        >
        <Button class="btn-primary" disabled={submitDisabled} onclick={submit}>
          {stage === 'submitting'
            ? t('settings.e2ee.recovering')
            : t('settings.e2ee.recover_button')}
        </Button>
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

  :global(.phrase-textarea) {
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

  :global(.phrase-textarea):focus {
    border-color: var(--accent-primary);
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
