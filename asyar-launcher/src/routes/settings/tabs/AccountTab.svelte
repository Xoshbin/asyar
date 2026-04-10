<script lang="ts">
  import { SettingsForm, SettingsFormRow, Button, LoadingState } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { authService } from '../../../services/auth/authService.svelte';
  import { cloudSyncService } from '../../../services/sync/cloudSyncService.svelte';
  import { entitlementService } from '../../../services/auth/entitlementService.svelte';

  let { handler: _handler }: { handler: SettingsHandler } = $props();

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
  <!-- ── Awaiting OAuth state ─────────────────────────────────── -->
  <div class="awaiting-container">
    <LoadingState message="Waiting for browser login..." />
    <Button onclick={handleCancel}>Cancel</Button>
  </div>

{:else if !authService.isLoggedIn}
  <!-- ── Logged out state ───────────────────────────────────────── -->
  <div class="no-separators">
    <SettingsForm>
      {#if authService.loginError}
        <SettingsFormRow label="">
          <div class="error-banner">{authService.loginError}</div>
        </SettingsFormRow>
      {/if}

      <SettingsFormRow label="GitHub">
        <button
          class="provider-btn"
          onclick={() => handleSignIn('github')}
          disabled={authService.isLoading}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
          Sign in with GitHub
        </button>
      </SettingsFormRow>

      <SettingsFormRow label="Google">
        <button
          class="provider-btn"
          onclick={() => handleSignIn('google')}
          disabled={authService.isLoading}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </SettingsFormRow>

      <SettingsFormRow label="">
        <p class="terms-text">By signing in, you agree to the Asyar Terms of Service and Privacy Policy.</p>
      </SettingsFormRow>
    </SettingsForm>
  </div>

{:else}
  <!-- ── Logged in state ────────────────────────────────────────── -->

  <!-- Profile & Entitlements -->
  <div class="no-separators">
    <SettingsForm>
      <SettingsFormRow label="">
        <div class="profile-row">
          {#if authService.user?.avatarUrl}
            <img
              src={authService.user.avatarUrl}
              alt="Avatar"
              class="avatar"
            />
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
            {authService.isLoading ? 'Signing out…' : 'Sign Out'}
          </Button>
        </div>
      </SettingsFormRow>

      <SettingsFormRow label="Features">
        {#if authService.entitlements.length === 0}
          <div class="no-subscription">
            <span class="secondary-text">No active subscription.</span>
            <button
              class="text-link"
              onclick={() => { import('@tauri-apps/plugin-opener').then(m => m.openUrl('https://asyar.org/pricing')); }}
            >
              View plans
            </button>
          </div>
        {:else}
          <div class="entitlements-list">
            {#each authService.entitlements as entitlement (entitlement)}
              <div class="entitlement-item">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" fill="color-mix(in srgb, var(--accent-success) 20%, transparent)" stroke="var(--accent-success)" stroke-width="1.5"/>
                  <path d="M5 8l2 2 4-4" stroke="var(--accent-success)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="entitlement-label">{labelFor(entitlement)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </SettingsFormRow>
    </SettingsForm>
  </div>

  <!-- Subscription -->
  <div class="no-separators">
    <SettingsForm>
      <SettingsFormRow label="Subscription" separator>
        <Button onclick={() => { import('@tauri-apps/plugin-opener').then(m => m.openUrl('https://asyar.org/settings/subscription')); }}>
          Open
        </Button>
      </SettingsFormRow>
    </SettingsForm>
  </div>

  <!-- Cloud Sync -->
  {#if entitlementService.check('sync:settings')}
    <div class="no-separators">
    <SettingsForm>
      <SettingsFormRow label="Last Synced" separator>
        <div class="sync-status">
          <span class="secondary-text">
            {cloudSyncService.lastSyncedAt ? formatRelativeTime(cloudSyncService.lastSyncedAt) : 'Not yet synced'}
          </span>
          {#if cloudSyncService.lastError}
            <span class="error-text">{cloudSyncService.lastError}</span>
          {/if}
        </div>
      </SettingsFormRow>

      <SettingsFormRow label="Sync Now">
        <Button
          onclick={() => cloudSyncService.upload().catch(() => {})}
          disabled={cloudSyncService.status === 'uploading' || cloudSyncService.status === 'downloading'}
        >
          {cloudSyncService.status === 'uploading' ? 'Uploading…' : 'Sync Now'}
        </Button>
      </SettingsFormRow>

      <SettingsFormRow label="Restore from Cloud">
        <Button
          onclick={() => cloudSyncService.restore().catch(() => {})}
          disabled={cloudSyncService.status === 'uploading' || cloudSyncService.status === 'downloading'}
        >
          {cloudSyncService.status === 'downloading' ? 'Restoring…' : 'Restore'}
        </Button>
      </SettingsFormRow>
    </SettingsForm>
    </div>
  {/if}
{/if}

<style>
  .no-separators :global(.form-row) {
    border-bottom: none;
  }

  .no-separators :global(.form-row.separator) {
    border-top: none;
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

  /* Provider sign-in buttons */
  .provider-btn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--separator);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    font-weight: 500;
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }

  .provider-btn:hover {
    opacity: 0.8;
  }

  .provider-btn:active {
    opacity: 0.6;
  }

  .provider-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
</style>
