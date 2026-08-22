<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Button,
    LoadingState,
    Toggle,
    Badge,
    StatusDot,
    SettingsCard,
    SettingsRow,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { authService } from '../../../services/auth/authService.svelte';
  import { cloudSyncService } from '../../../services/sync/cloudSyncService.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { entitlementService } from '../../../services/auth/entitlementService.svelte';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { logService } from '../../../services/log/logService';
  import { syncEncryptionService } from '../../../services/sync/syncEncryptionService.svelte';
  import EncryptionEnrolmentDialog from '../../../components/settings/EncryptionEnrolmentDialog.svelte';
  import PassphraseDialog from '../../../components/settings/PassphraseDialog.svelte';
  import RotatePassphraseDialog from '../../../components/settings/RotatePassphraseDialog.svelte';
  import RecoverWithMnemonicDialog from '../../../components/settings/RecoverWithMnemonicDialog.svelte';
  import RecoveryPhraseDialog from '../../../components/settings/RecoveryPhraseDialog.svelte';
  import DisableE2eeDialog from '../../../components/settings/DisableE2eeDialog.svelte';
  import { t } from '../../../services/i18n';

  function reportSyncFailure(err: unknown): void {
    logService.error(`[AccountTab] cloud sync failed: ${err}`);
    feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: false,
      context: { message: 'Cloud sync failed' },
    });
  }

  let { handler: _handler }: { handler: SettingsHandler } = $props();

  type ActiveDialog = null | 'enrol' | 'unlock' | 'rotate' | 'phrase' | 'recover' | 'disable';
  let activeDialog = $state<ActiveDialog>(null);

  // Local mirror of the service's enabled state; keeps the toggle visual
  // in sync with the service even during the dialog open/cancel cycle.
  let toggleState = $state(syncEncryptionService.enabled);

  $effect(() => {
    toggleState = syncEncryptionService.enabled;
  });

  // Same mirror idiom for the cloud-sync preference toggle. The tab only
  // writes the setting — cloudSyncService watches it and starts/stops
  // itself — so the mirror snaps back only if the write fails.
  let syncToggleState = $state(cloudSyncService.enabled);

  $effect(() => {
    syncToggleState = cloudSyncService.enabled;
  });

  function revertSyncToggle(previous: boolean, reason: string) {
    logService.error(`[AccountTab] toggling cloud sync failed: ${reason}`);
    syncToggleState = previous;
    // updateSettings mutates the in-memory settings BEFORE saving, so a
    // failed save leaves the new value live (and the sync watcher acting
    // on it) — re-reading cloudSyncService.enabled here would return the
    // value that just failed to persist. Write the old value back so the
    // UI, the in-memory settings, and the service agree again; if
    // persistence is still failing this at least restores the in-session
    // state.
    settingsService.updateSettings('user', { syncEnabled: previous }).catch(() => {});
  }

  function onSyncToggleClick(target: boolean) {
    const previous = cloudSyncService.enabled;
    settingsService
      .updateSettings('user', { syncEnabled: target })
      .then((ok) => {
        if (!ok) revertSyncToggle(previous, 'settings save returned false');
      })
      .catch((err) => revertSyncToggle(previous, String(err)));
  }

  function resetToggle() {
    toggleState = syncEncryptionService.enabled;
  }

  onMount(() => {
    syncEncryptionService.refreshStatus().catch((err) => {
      logService.warn(`refresh e2ee status failed: ${String(err)}`);
    });
  });

  function onToggleClick(target: boolean) {
    if (target && !syncEncryptionService.enabled) {
      activeDialog = 'enrol';
    } else if (!target && syncEncryptionService.enabled) {
      activeDialog = 'disable';
    }
  }

  const ENTITLEMENT_LABELS: Record<string, string> = {
    'sync:settings': 'Settings Sync',
    'sync:ai-conversations': 'AI Conversation History Sync',
    'ai:chat': 'AI Chat',
    'ai:advanced-models': 'Advanced AI Models',
    'extensions:premium': 'Premium Extensions',
  };

  function labelFor(entitlement: string): string {
    return ENTITLEMENT_LABELS[entitlement] ?? entitlement;
  }

  async function handleSignIn(provider: string) {
    await authService.startLogin(provider);
  }

  async function handleSignOut() {
    await authService.logout();
  }

  function handleCancel() {
    authService.cancelLoginPolling();
  }

  function formatRelativeTime(date: Date | null): string {
    if (!date) return 'Never';
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
</script>

{#if authService.isAwaitingOAuth}
  <div class="section-header">{t('settings.account.section_profile')}</div>
  <div id="account-profile" class="anchor-group">
    <SettingsCard>
      <div class="awaiting-container">
        <LoadingState message="Waiting for browser login..." />
        <Button onclick={handleCancel}>{t('common.cancel')}</Button>
      </div>
    </SettingsCard>
  </div>

  <div class="section-header">{t('settings.account.section_subscription')}</div>
  <div id="account-subscription" class="anchor-group">
    <SettingsCard>
      <SettingsRow
        label={t('settings.account.section_subscription')}
        description={t('settings.account.subscription_pending')}
      >
        <span class="secondary-text">{t('settings.account.pending_login')}</span>
      </SettingsRow>
    </SettingsCard>
  </div>

  <div class="section-header">{t('settings.account.section_sync')}</div>
  <div id="account-sync" class="anchor-group">
    <SettingsCard>
      <SettingsRow
        label={t('settings.account.section_sync')}
        description={t('settings.account.sync_pending')}
      >
        <span class="secondary-text">{t('settings.account.pending_login')}</span>
      </SettingsRow>
    </SettingsCard>
  </div>
{:else if !authService.isLoggedIn}
  <div class="section-header">{t('settings.account.section_profile')}</div>
  <div id="account-profile" class="anchor-group">
    <SettingsCard>
      {#if authService.loginError}
        <SettingsRow label={t('settings.account.sign_in_error')}>
          <div class="error-banner">{authService.loginError}</div>
        </SettingsRow>
      {/if}

      <SettingsRow label="GitHub" description={t('settings.account.github_desc')}>
        <Button onclick={() => handleSignIn('github')} disabled={authService.isLoading}>
          {t('settings.account.sign_in')}
        </Button>
      </SettingsRow>

      <SettingsRow label="Google" description={t('settings.account.google_desc')}>
        <Button onclick={() => handleSignIn('google')} disabled={authService.isLoading}>
          {t('settings.account.sign_in')}
        </Button>
      </SettingsRow>

      <SettingsRow label={t('settings.account.terms')}>
        <p class="terms-text">
          {t('settings.account.terms_text')}
        </p>
      </SettingsRow>
    </SettingsCard>
  </div>

  <div class="section-header">{t('settings.account.section_subscription')}</div>
  <div id="account-subscription" class="anchor-group">
    <SettingsCard>
      <SettingsRow
        label={t('settings.account.section_subscription')}
        description={t('settings.account.subscription_not_signed_in_desc')}
      >
        <span class="secondary-text">{t('settings.account.not_signed_in')}</span>
      </SettingsRow>
    </SettingsCard>
  </div>

  <div class="section-header">{t('settings.account.section_sync')}</div>
  <div id="account-sync" class="anchor-group">
    <SettingsCard>
      <SettingsRow
        label={t('settings.account.section_sync')}
        description={t('settings.account.sync_not_signed_in_desc')}
      >
        <span class="secondary-text">{t('settings.account.not_signed_in')}</span>
      </SettingsRow>
    </SettingsCard>
  </div>
{:else}
  <div class="section-header">{t('settings.account.section_profile')}</div>
  <div id="account-profile" class="anchor-group">
    <SettingsCard>
      <SettingsRow label={t('settings.account.section_profile')}>
        <div class="profile-row">
          {#if authService.user?.avatarUrl}
            <img src={authService.user.avatarUrl} alt="Avatar" class="avatar" />
          {:else}
            <div class="avatar-placeholder">
              {authService.user?.name?.charAt(0).toUpperCase() ?? '?'}
            </div>
          {/if}
          <div class="profile-info">
            <span class="profile-name">{authService.user?.name ?? 'Unknown'}</span>
            <span class="profile-email">{authService.user?.email ?? ''}</span>
          </div>
          <Button onclick={handleSignOut} disabled={authService.isLoading}>
            {authService.isLoading ? 'Signing out…' : t('settings.account.sign_out')}
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow label="Features">
        {#if authService.entitlements.length === 0}
          <div class="no-subscription">
            <span class="secondary-text">No active subscription.</span>
            <button
              class="text-link"
              onclick={() => {
                import('@tauri-apps/plugin-opener').then((m) =>
                  m.openUrl('https://asyar.org/pricing'),
                );
              }}
            >
              View plans
            </button>
          </div>
        {:else}
          <div class="entitlements-list">
            {#each authService.entitlements as entitlement (entitlement)}
              <div class="entitlement-item">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle
                    cx="8"
                    cy="8"
                    r="7"
                    fill="color-mix(in srgb, var(--accent-success) 20%, transparent)"
                    stroke="var(--accent-success)"
                    stroke-width="1.5"
                  />
                  <path
                    d="M5 8l2 2 4-4"
                    stroke="var(--accent-success)"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="entitlement-label">{labelFor(entitlement)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </SettingsRow>
    </SettingsCard>
  </div>

  <div class="section-header">{t('settings.account.section_subscription')}</div>
  <div id="account-subscription" class="anchor-group">
    <SettingsCard>
      <SettingsRow
        label={t('settings.account.section_subscription')}
        description={t('settings.account.open_billing_desc')}
      >
        <Button
          onclick={() => {
            import('@tauri-apps/plugin-opener').then((m) =>
              m.openUrl('https://asyar.org/settings/subscription'),
            );
          }}
        >
          {t('settings.account.manage_subscription')}
        </Button>
      </SettingsRow>
    </SettingsCard>
  </div>

  <div class="section-header">{t('settings.account.section_sync')}</div>
  <div id="account-sync" class="anchor-group">
    <SettingsCard>
      {#if entitlementService.check('sync:settings')}
        <SettingsRow label={t('settings.account.section_sync')}>
          <div class="sync-enable-row">
            <span class="secondary-text">
              {syncToggleState
                ? 'Syncing your data across devices.'
                : 'Your data stays on this device.'}
            </span>
            <Toggle
              bind:checked={syncToggleState}
              onchange={(e) => onSyncToggleClick((e.target as HTMLInputElement).checked)}
            />
          </div>
        </SettingsRow>

        {#if cloudSyncService.enabled}
          <SettingsRow label={t('settings.account.last_synced')}>
            <div class="sync-status">
              <span class="secondary-text">
                {cloudSyncService.lastSyncedAt
                  ? formatRelativeTime(cloudSyncService.lastSyncedAt)
                  : 'Not yet synced'}
              </span>
              {#if cloudSyncService.lastError}
                <span class="error-text">{cloudSyncService.lastError}</span>
              {/if}
            </div>
          </SettingsRow>

          <SettingsRow label={t('settings.account.sync_now')}>
            <Button
              onclick={() => cloudSyncService.syncNow().catch((err) => reportSyncFailure(err))}
              disabled={cloudSyncService.status === 'syncing'}
            >
              {cloudSyncService.status === 'syncing'
                ? t('settings.account.syncing')
                : t('settings.account.sync_now')}
            </Button>
          </SettingsRow>

          <SettingsRow label={t('settings.account.encrypted_sync')}>
            <div class="e2ee-row">
              <div class="e2ee-status">
                {#if !syncEncryptionService.enabled}
                  <Badge text="Off" variant="default" />
                  <span class="secondary-text">Server can read your synced data.</span>
                {:else if syncEncryptionService.locked}
                  <div class="e2ee-badge-with-dot">
                    <StatusDot color="warning" />
                    <Badge text={t('settings.account.locked')} variant="warning" />
                  </div>
                  <span class="secondary-text">Passphrase needed to continue.</span>
                {:else}
                  <div class="e2ee-badge-with-dot">
                    <StatusDot color="success" />
                    <Badge text="On" variant="success" />
                  </div>
                  <span class="secondary-text">Server stores only ciphertext.</span>
                {/if}
              </div>
              <Toggle
                bind:checked={toggleState}
                onchange={(e) => onToggleClick((e.target as HTMLInputElement).checked)}
              />
            </div>
          </SettingsRow>

          {#if syncEncryptionService.enabled}
            {#if syncEncryptionService.locked}
              <SettingsRow label={t('settings.account.locked')}>
                <Button onclick={() => (activeDialog = 'unlock')}
                  >{t('settings.account.enter_passphrase')}</Button
                >
              </SettingsRow>
            {/if}
            <SettingsRow label={t('settings.account.passphrase')}>
              <Button onclick={() => (activeDialog = 'rotate')}
                >{t('settings.account.change_passphrase')}</Button
              >
            </SettingsRow>
            <SettingsRow label={t('settings.account.recovery_phrase')}>
              <div class="e2ee-phrase-actions">
                <Button onclick={() => (activeDialog = 'phrase')}
                  >{t('settings.account.view_recovery_phrase')}</Button
                >
                <Button onclick={() => (activeDialog = 'recover')}
                  >{t('settings.account.forgot_passphrase')}</Button
                >
              </div>
            </SettingsRow>
          {/if}
        {/if}
      {:else}
        <SettingsRow
          label={t('settings.account.section_sync')}
          description={t('settings.account.plan_no_sync')}
        >
          <span class="secondary-text">Unavailable</span>
        </SettingsRow>
      {/if}
    </SettingsCard>
  </div>

  {#if activeDialog === 'enrol'}
    <EncryptionEnrolmentDialog
      isOpen={true}
      onComplete={() => (activeDialog = null)}
      onCancel={() => {
        activeDialog = null;
        resetToggle();
      }}
    />
  {:else if activeDialog === 'unlock'}
    <PassphraseDialog
      isOpen={true}
      title={t('settings.account.encrypted_sync')}
      description={t('settings.account.unlock_key_desc')}
      onComplete={() => (activeDialog = null)}
      onCancel={() => (activeDialog = null)}
      onForgot={() => (activeDialog = 'recover')}
    />
  {:else if activeDialog === 'rotate'}
    <RotatePassphraseDialog
      isOpen={true}
      onComplete={() => (activeDialog = null)}
      onCancel={() => (activeDialog = null)}
    />
  {:else if activeDialog === 'phrase'}
    <RecoveryPhraseDialog
      isOpen={true}
      onComplete={() => (activeDialog = null)}
      onCancel={() => (activeDialog = null)}
    />
  {:else if activeDialog === 'recover'}
    <RecoverWithMnemonicDialog
      isOpen={true}
      onComplete={() => (activeDialog = null)}
      onCancel={() => (activeDialog = null)}
    />
  {:else if activeDialog === 'disable'}
    <DisableE2eeDialog
      isOpen={true}
      onComplete={() => (activeDialog = null)}
      onCancel={() => {
        activeDialog = null;
        resetToggle();
      }}
    />
  {/if}
{/if}

<style>
  .anchor-group {
    scroll-margin-top: var(--space-6);
  }

  /* Awaiting OAuth */
  .awaiting-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-6);
    color: var(--text-secondary);
  }

  /* Error banner */
  .error-banner {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent-danger) 12%, var(--bg-secondary));
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
  }

  /* Terms */
  .terms-text {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-family: var(--font-ui);
  }

  /* Profile row */
  .profile-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-2) 0;
  }

  .avatar {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    flex-shrink: 0;
    border: 2px solid var(--separator);
  }

  .avatar-placeholder {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: var(--font-size-base);
    font-weight: 600;
    font-family: var(--font-ui);
  }

  .profile-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .profile-name {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .profile-email {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Entitlements */
  .entitlements-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .entitlement-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .entitlement-label {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  /* No subscription */
  .no-subscription {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
  }

  .secondary-text {
    color: var(--text-secondary);
  }

  .text-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-primary);
    text-decoration: underline;
  }

  /* Sync status */
  .sync-enable-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .sync-enable-row .secondary-text {
    flex: 1;
    min-width: 0;
  }

  .sync-status {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .error-text {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    font-family: var(--font-ui);
  }

  .e2ee-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .e2ee-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
  }

  .e2ee-badge-with-dot {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .e2ee-phrase-actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
