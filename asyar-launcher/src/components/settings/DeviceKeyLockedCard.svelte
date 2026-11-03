<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../../services/i18n';
  import { Button, Textarea } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';
  import { getDeviceName } from '../../lib/device/deviceName';
  import { parsePhraseInput, joinPhraseForWire } from './RecoverWithMnemonicDialog.logic';
  import { logService } from '../../services/log/logService';

  let {
    onResetClick,
  }: {
    onResetClick?: () => void;
  } = $props();

  type TabMode = 'phrase' | 'pair';
  let activeTab = $state<TabMode>('phrase');

  // ── Recovery phrase flow ───────────────────────────────────────────────────
  let phraseInput = $state('');
  let parsed = $derived(parsePhraseInput(phraseInput));
  let isUnlocking = $state(false);
  let phraseError = $state<string | null>(null);

  async function handleUnlockWithPhrase() {
    if (!parsed.isValid || isUnlocking) return;
    isUnlocking = true;
    phraseError = null;
    try {
      const phrase = joinPhraseForWire(parsed.words);
      await syncEncryptionService.unlockWithPhrase(phrase);
    } catch (err) {
      logService.warn(`Device unlock with phrase failed: ${String(err)}`);
      phraseError = t('settings.e2ee.error_invalid_phrase');
      isUnlocking = false;
      return;
    }
    phraseInput = '';
    isUnlocking = false;
    await syncAfterUnlock();
  }

  // The device is already unlocked at this point. A failed sync is not an
  // unlock failure and the periodic sync will retry, so it is only logged.
  async function syncAfterUnlock() {
    try {
      await cloudSyncService.syncNow();
    } catch (err) {
      logService.warn(`Sync after unlock failed: ${String(err)}`);
    }
  }

  // ── Pairing flow (requester / new device) ──────────────────────────────────
  type PairingStage =
    | 'idle'
    | 'requesting'
    | 'requested'
    | 'awaiting-confirmation'
    | 'confirming'
    | 'expired'
    | 'rejected'
    | 'mismatch-warning';

  let pairingStage = $state<PairingStage>('idle');
  let pairingId = $state<string | null>(null);
  let fingerprintWords = $state<string>('');
  let confirmationWords = $state<string>('');
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function startPairing() {
    stopPolling();
    pairingStage = 'requesting';
    try {
      const deviceName = await getDeviceName();
      const res = await syncEncryptionService.requestPairing(deviceName);
      pairingId = res.id;
      fingerprintWords = res.fingerprint;
      pairingStage = 'requested';
      startPolling(res.id);
    } catch (err) {
      logService.warn(`Pairing request failed: ${String(err)}`);
      pairingStage = 'idle';
    }
  }

  function startPolling(id: string) {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const poll = await syncEncryptionService.pollPairing(id);
        // Ignore a result that arrives after cancel, reject or a restart.
        if (pairingId !== id || pollTimer === null) return;
        if (poll.status === 'awaiting-confirmation' && poll.confirmationWords) {
          stopPolling();
          confirmationWords = poll.confirmationWords;
          pairingStage = 'awaiting-confirmation';
        } else if (poll.status === 'expired') {
          stopPolling();
          pairingStage = 'expired';
        } else if (poll.status === 'rejected' || poll.status === 'cancelled') {
          stopPolling();
          pairingStage = 'rejected';
        }
      } catch (err) {
        logService.debug?.(`Pairing poll error: ${String(err)}`);
      }
    }, 3000);
  }

  async function handleConfirmPairing() {
    if (!pairingId || pairingStage === 'confirming') return;
    pairingStage = 'confirming';
    try {
      await syncEncryptionService.confirmPairing(pairingId);
    } catch (err) {
      logService.warn(`Pairing confirm failed: ${String(err)}`);
      pairingStage = 'rejected';
      return;
    }
    stopPolling();
    pairingStage = 'idle';
    pairingId = null;
    await syncAfterUnlock();
  }

  async function handleRejectPairing() {
    stopPolling();
    if (pairingId) {
      await syncEncryptionService.rejectPairing(pairingId).catch(() => {});
      pairingId = null;
    }
    pairingStage = 'mismatch-warning';
  }

  async function handleCancelPairing() {
    stopPolling();
    if (pairingId) {
      await syncEncryptionService.cancelPairing(pairingId).catch(() => {});
      pairingId = null;
    }
    pairingStage = 'idle';
  }

  onDestroy(() => {
    stopPolling();
    if (pairingId && (pairingStage === 'requested' || pairingStage === 'awaiting-confirmation')) {
      syncEncryptionService.cancelPairing(pairingId).catch(() => {});
    }
  });
</script>

<div class="locked-card">
  <div class="locked-header">
    <div class="locked-icon-wrapper">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 10V8C6 4.686 8.686 2 12 2C15.314 2 18 4.686 18 8V10M6 10H18M6 10C4.895 10 4 10.895 4 12V20C4 21.105 4.895 22 6 22H18C19.105 22 20 21.105 20 20V12C20 10.895 19.105 10 18 10"
          stroke="var(--accent-warning)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="12" cy="16" r="1.5" fill="var(--accent-warning)" />
      </svg>
    </div>
    <div class="locked-titles">
      <h3 class="locked-title">{t('settings.e2ee.locked_card_title')}</h3>
      <p class="locked-desc">{t('settings.e2ee.locked_card_desc')}</p>
    </div>
  </div>

  <div class="tab-selectors">
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'phrase'}
      onclick={() => (activeTab = 'phrase')}
    >
      {t('settings.e2ee.enter_recovery_phrase_tab')}
    </button>
    <button
      type="button"
      class="tab-btn"
      class:active={activeTab === 'pair'}
      onclick={() => {
        activeTab = 'pair';
        if (pairingStage === 'idle') startPairing();
      }}
    >
      {t('settings.e2ee.approve_from_device_tab')}
    </button>
  </div>

  <div class="tab-content">
    {#if activeTab === 'phrase'}
      <div class="phrase-form">
        <Textarea
          unstyled
          textIntent="exact"
          class="phrase-textarea"
          bind:value={phraseInput}
          placeholder={t('settings.e2ee.unlock_phrase_placeholder')}
          rows="4"
          autocomplete="off"
        ></Textarea>

        <div class="phrase-meta-row">
          <span class="text-caption">
            {t('settings.e2ee.words_count', { count: parsed.words.length })}
          </span>
          {#if parsed.unknownWords.length > 0}
            <span class="text-caption error">
              {t(
                parsed.unknownWords.length === 1
                  ? 'settings.e2ee.unknown_word'
                  : 'settings.e2ee.unknown_words',
                { words: parsed.unknownWords.join(', ') },
              )}
            </span>
          {/if}
        </div>

        {#if phraseError}
          <div class="error-banner">{phraseError}</div>
        {/if}

        <div class="actions-row">
          <Button
            class="btn-primary"
            disabled={!parsed.isValid || isUnlocking}
            onclick={handleUnlockWithPhrase}
          >
            {isUnlocking ? t('settings.e2ee.unlocking') : t('settings.e2ee.unlock_button')}
          </Button>
        </div>
      </div>
    {:else if activeTab === 'pair'}
      <div class="pairing-panel">
        {#if pairingStage === 'idle'}
          <div class="pair-idle">
            <Button class="btn-primary" onclick={startPairing}>
              {t('settings.e2ee.pairing_step1_title')}
            </Button>
          </div>
        {:else if pairingStage === 'requesting'}
          <div class="pair-status-box">
            <span class="secondary-text">{t('settings.e2ee.pairing_waiting_approval')}</span>
          </div>
        {:else if pairingStage === 'requested'}
          <div class="pair-fingerprint-step">
            <p class="pair-instruction">{t('settings.e2ee.pairing_step1_desc')}</p>
            <div class="words-grid">
              {#each fingerprintWords.split(' ') as word, idx (idx)}
                <div class="word-card">
                  <span class="word-num">{idx + 1}</span>
                  <span class="word-text">{word}</span>
                </div>
              {/each}
            </div>
            <div class="waiting-indicator">
              <span class="pulse-dot"></span>
              <span class="secondary-text">{t('settings.e2ee.pairing_waiting_approval')}</span>
            </div>
            <div class="actions-row">
              <Button onclick={handleCancelPairing}>{t('settings.e2ee.pairing_cancel')}</Button>
            </div>
          </div>
        {:else if pairingStage === 'awaiting-confirmation' || pairingStage === 'confirming'}
          <div class="pair-confirm-step">
            <h4 class="confirm-title">{t('settings.e2ee.pairing_confirm_title')}</h4>
            <p class="pair-instruction">{t('settings.e2ee.pairing_confirm_question')}</p>
            <div class="words-grid">
              {#each confirmationWords.split(' ') as word, idx (idx)}
                <div class="word-card highlight">
                  <span class="word-num">{idx + 1}</span>
                  <span class="word-text">{word}</span>
                </div>
              {/each}
            </div>
            <div class="actions-row">
              <Button onclick={handleRejectPairing}>
                {t('settings.e2ee.pairing_mismatch_btn')}
              </Button>
              <Button
                class="btn-primary"
                disabled={pairingStage === 'confirming'}
                onclick={handleConfirmPairing}
              >
                {pairingStage === 'confirming'
                  ? t('settings.e2ee.unlocking')
                  : t('settings.e2ee.pairing_confirm_btn')}
              </Button>
            </div>
          </div>
        {:else if pairingStage === 'mismatch-warning'}
          <div class="security-warning-box">
            <p class="warning-text">{t('settings.e2ee.pairing_mismatch_warning')}</p>
            <div class="actions-row">
              <Button class="btn-primary" onclick={startPairing}>
                {t('settings.e2ee.pairing_retry')}
              </Button>
            </div>
          </div>
        {:else if pairingStage === 'expired'}
          <div class="info-box">
            <p class="secondary-text">{t('settings.e2ee.pairing_expired')}</p>
            <div class="actions-row">
              <Button class="btn-primary" onclick={startPairing}>
                {t('settings.e2ee.pairing_retry')}
              </Button>
            </div>
          </div>
        {:else if pairingStage === 'rejected'}
          <div class="info-box">
            <p class="secondary-text">{t('settings.e2ee.pairing_rejected')}</p>
            <div class="actions-row">
              <Button class="btn-primary" onclick={startPairing}>
                {t('settings.e2ee.pairing_retry')}
              </Button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="escape-hatch-row">
    <button type="button" class="text-link" onclick={() => onResetClick?.()}>
      {t('settings.e2ee.locked_escape_hatch')}
    </button>
  </div>
</div>

<style>
  .locked-card {
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .locked-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .locked-icon-wrapper {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .locked-titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .locked-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-ui);
    margin: 0;
  }

  .locked-desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    line-height: 1.4;
    margin: 0;
  }

  .tab-selectors {
    display: flex;
    border-bottom: 1px solid var(--separator);
    gap: var(--space-2);
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    cursor: default;
    transition: all 0.15s ease;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-primary);
    font-weight: 500;
  }

  .tab-content {
    display: flex;
    flex-direction: column;
  }

  .phrase-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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
    box-sizing: border-box;
  }

  :global(.phrase-textarea:focus) {
    outline: none;
    border-color: var(--accent-primary);
  }

  .phrase-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .text-caption {
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
    color: var(--text-secondary);
  }

  .text-caption.error {
    color: var(--accent-danger);
  }

  .error-banner {
    background: color-mix(in srgb, var(--accent-danger) 15%, transparent);
    color: var(--accent-danger);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
  }

  .actions-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .pairing-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .pair-instruction {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    margin: 0 0 var(--space-2) 0;
  }

  .words-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .word-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .word-card.highlight {
    border-color: var(--accent-primary);
  }

  .word-num {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .word-text {
    font-size: var(--font-size-base);
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }

  .waiting-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-warning);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
    100% {
      opacity: 0.4;
    }
  }

  .confirm-title {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-ui);
    margin: 0;
  }

  .security-warning-box {
    background: color-mix(in srgb, var(--accent-danger) 15%, transparent);
    border: 1px solid var(--accent-danger);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .warning-text {
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
    font-weight: 500;
    margin: 0 0 var(--space-2) 0;
    font-family: var(--font-ui);
  }

  .info-box {
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .secondary-text {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    margin: 0;
  }

  .escape-hatch-row {
    border-top: 1px solid var(--separator);
    padding-top: var(--space-3);
    display: flex;
    justify-content: center;
  }

  .text-link {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
    cursor: default;
    text-decoration: underline;
  }

  .text-link:hover {
    color: var(--text-primary);
  }
</style>
