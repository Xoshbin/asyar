<script lang="ts">
  import { t } from '../../services/i18n';
  import { Button } from '../index';
  import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
  import { logService } from '../../services/log/logService';

  let isChecking = $state(false);
  let approvingId = $state<string | null>(null);
  let approvedInfo = $state<{ deviceName: string; confirmationWords: string } | null>(null);
  let errorMessage = $state<string | null>(null);
  let warningMessage = $state<string | null>(null);

  async function handleCheck() {
    if (isChecking) return;
    isChecking = true;
    errorMessage = null;
    warningMessage = null;
    try {
      await syncEncryptionService.checkIncomingPairings();
    } catch (err) {
      logService.warn(`Check incoming pairings failed: ${String(err)}`);
    } finally {
      isChecking = false;
    }
  }

  async function handleApprove(id: string, deviceName: string, fingerprint: string) {
    if (approvingId !== null) return;
    approvingId = id;
    errorMessage = null;
    warningMessage = null;
    try {
      const res = await syncEncryptionService.approvePairing(id, fingerprint);
      approvedInfo = {
        deviceName,
        confirmationWords: res.confirmationWords,
      };
    } catch (err: any) {
      logService.error(`Approve pairing failed: ${String(err)}`);
      const errStr = String(err?.message ?? err);
      if (
        errStr.includes('fingerprint') ||
        errStr.includes('mismatch') ||
        err?.kind === 'sync_pairing_fingerprint_mismatch' ||
        err?.diagnostic?.kind === 'sync_pairing_fingerprint_mismatch'
      ) {
        warningMessage = t('settings.e2ee.fingerprint_mismatch_warning');
      } else {
        errorMessage = errStr;
      }
    } finally {
      approvingId = null;
    }
  }

  async function handleDeny(id: string) {
    errorMessage = null;
    warningMessage = null;
    try {
      await syncEncryptionService.cancelPairing(id);
      await syncEncryptionService.checkIncomingPairings();
    } catch (err) {
      logService.warn(`Deny pairing failed: ${String(err)}`);
    }
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }
</script>

<div class="incoming-section">
  <div class="incoming-header">
    <span class="section-label">{t('settings.e2ee.incoming_requests_title')}</span>
    <Button disabled={isChecking} onclick={handleCheck}>
      {isChecking ? t('settings.e2ee.incoming_checking') : t('settings.e2ee.incoming_check_btn')}
    </Button>
  </div>

  {#if warningMessage}
    <div class="security-warning-box">
      <p class="warning-text">{warningMessage}</p>
    </div>
  {/if}

  {#if errorMessage}
    <div class="error-banner">{errorMessage}</div>
  {/if}

  {#if approvedInfo}
    <div class="approved-box">
      <h4 class="approved-title">{t('settings.e2ee.incoming_approved_title')}</h4>
      <p class="approved-instruction">
        {t('settings.e2ee.incoming_approved_instruction', { deviceName: approvedInfo.deviceName })}
      </p>
      <div class="words-grid">
        {#each approvedInfo.confirmationWords.split(' ') as word, idx (idx)}
          <div class="word-card">
            <span class="word-num">{idx + 1}</span>
            <span class="word-text">{word}</span>
          </div>
        {/each}
      </div>
      <div class="approved-actions">
        <Button class="btn-primary" onclick={() => (approvedInfo = null)}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  {/if}

  {#if syncEncryptionService.incomingPairings.length > 0}
    <div class="requests-list">
      {#each syncEncryptionService.incomingPairings as req (req.id)}
        <div class="request-card">
          <div class="request-top">
            <span class="request-device">
              {t('settings.e2ee.incoming_request_label', { deviceName: req.deviceName })}
            </span>
            <span class="request-time">{formatTime(req.createdAt)}</span>
          </div>
          <p class="request-prompt">
            {t('settings.e2ee.incoming_compare_prompt', { deviceName: req.deviceName })}
          </p>
          <div class="words-grid">
            {#each req.fingerprint.split(' ') as word, idx (idx)}
              <div class="word-card">
                <span class="word-num">{idx + 1}</span>
                <span class="word-text">{word}</span>
              </div>
            {/each}
          </div>
          <div class="request-actions">
            <Button disabled={approvingId === req.id} onclick={() => handleDeny(req.id)}>
              {t('settings.e2ee.incoming_deny_btn')}
            </Button>
            <Button
              class="btn-primary"
              disabled={approvingId === req.id}
              onclick={() => handleApprove(req.id, req.deviceName, req.fingerprint)}
            >
              {approvingId === req.id
                ? t('settings.e2ee.unlocking')
                : t('settings.e2ee.incoming_approve_btn')}
            </Button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .incoming-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .incoming-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .requests-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .request-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .request-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .request-device {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .request-time {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
  }

  .request-prompt {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    margin: 0;
  }

  .words-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }

  .word-card {
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .word-num {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .word-text {
    font-size: var(--font-size-sm);
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }

  .request-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .approved-box {
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .approved-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-ui);
    margin: 0;
  }

  .approved-instruction {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    margin: 0;
  }

  .approved-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-1);
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
    margin: 0;
    font-family: var(--font-ui);
  }

  .error-banner {
    background: color-mix(in srgb, var(--accent-danger) 15%, transparent);
    color: var(--accent-danger);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
  }
</style>
