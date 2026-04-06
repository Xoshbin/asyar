<script lang="ts">
  import { SettingsSection, SettingsRow, Button, LoadingState } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { authService } from '../../../services/auth/authService.svelte';
  import { cloudSyncService } from '../../../services/sync/cloudSyncService.svelte';
  import { entitlementService } from '../../../services/auth/entitlementService.svelte';

  let { handler }: { handler: SettingsHandler } = $props();

  /** Human-readable labels for entitlement strings. */
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
  <SettingsSection title="Account">
    <div class="py-8 flex flex-col items-center gap-4" style="color: var(--text-secondary)">
      <LoadingState message="Waiting for browser login..." />
      <Button onclick={handleCancel}>Cancel</Button>
    </div>
  </SettingsSection>

{:else if !authService.isLoggedIn}
  <!-- ── Logged out state ───────────────────────────────────────── -->
  <SettingsSection
    title="Account"
    description="Sign in to sync your settings across devices and unlock premium features."
  >
    <div class="py-6 space-y-4">
      {#if authService.loginError}
        <div class="px-4 py-3 rounded-lg text-sm" style="background: color-mix(in srgb, var(--accent-danger) 12%, var(--bg-secondary)); color: var(--accent-danger);">
          {authService.loginError}
        </div>
      {/if}

      <div class="flex flex-col gap-3 pt-2">
        <button
          class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 active:opacity-60"
          style="background: var(--bg-tertiary); border: 1px solid var(--separator); color: var(--text-primary); cursor: pointer;"
          onclick={() => handleSignIn('github')}
          disabled={authService.isLoading}
        >
          <!-- GitHub icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
          Sign in with GitHub
        </button>

        <button
          class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 active:opacity-60"
          style="background: var(--bg-tertiary); border: 1px solid var(--separator); color: var(--text-primary); cursor: pointer;"
          onclick={() => handleSignIn('google')}
          disabled={authService.isLoading}
        >
          <!-- Google icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>

      <p class="text-xs pb-4" style="color: var(--text-tertiary)">
        By signing in, you agree to the Asyar Terms of Service and Privacy Policy.
      </p>
    </div>
  </SettingsSection>

{:else}
  <!-- ── Logged in state ────────────────────────────────────────── -->

  <!-- Profile section -->
  <SettingsSection title="Account">
    <div class="py-5 flex items-center gap-4 border-b" style="border-color: var(--separator)">
      <!-- Avatar -->
      {#if authService.user?.avatarUrl}
        <img
          src={authService.user.avatarUrl}
          alt="Avatar"
          class="w-12 h-12 rounded-full flex-shrink-0"
          style="border: 2px solid var(--separator)"
        />
      {:else}
        <div
          class="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-lg font-semibold"
          style="background: var(--bg-tertiary); color: var(--text-secondary);"
        >
          {authService.user?.name?.charAt(0).toUpperCase() ?? '?'}
        </div>
      {/if}

      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm truncate" style="color: var(--text-primary)">
          {authService.user?.name ?? 'Unknown'}
        </p>
        <p class="text-sm truncate" style="color: var(--text-secondary)">
          {authService.user?.email ?? ''}
        </p>
      </div>

      <Button onclick={handleSignOut} disabled={authService.isLoading}>
        {authService.isLoading ? 'Signing out…' : 'Sign Out'}
      </Button>
    </div>

    <!-- Entitlements -->
    <div class="py-4">
      {#if authService.entitlements.length === 0}
        <div class="py-3">
          <p class="text-sm" style="color: var(--text-secondary)">
            No active subscription.
            <button
              class="underline ml-1 text-sm"
              style="color: var(--text-primary); background: none; border: none; cursor: pointer; padding: 0;"
              onclick={() => { import('@tauri-apps/plugin-opener').then(m => m.openUrl('https://asyar.org/pricing')); }}
            >
              View plans
            </button>
          </p>
        </div>
      {:else}
        <p class="text-xs font-medium uppercase tracking-wide pb-3" style="color: var(--text-secondary)">
          Active Features
        </p>
        <div class="space-y-2">
          {#each authService.entitlements as entitlement (entitlement)}
            <div class="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="7" fill="color-mix(in srgb, var(--accent-success) 20%, transparent)" stroke="var(--accent-success)" stroke-width="1.5"/>
                <path d="M5 8l2 2 4-4" stroke="var(--accent-success)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="text-sm" style="color: var(--text-primary)">{labelFor(entitlement)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </SettingsSection>

  <!-- Manage subscription link -->
  <SettingsSection title="Subscription">
    <div class="py-4">
      <SettingsRow
        label="Manage Subscription"
        description="View plans, billing history, and upgrade options on asyar.org"
      >
        <Button onclick={() => { import('@tauri-apps/plugin-opener').then(m => m.openUrl('https://asyar.org/settings/subscription')); }}>
          Open
        </Button>
      </SettingsRow>
    </div>
  </SettingsSection>

  {#if entitlementService.check('sync:settings')}
    <SettingsSection title="Cloud Sync">
      <div class="py-4 space-y-4">
        <!-- Last synced status -->
        <SettingsRow
          label="Last Synced"
          description={cloudSyncService.lastSyncedAt
            ? formatRelativeTime(cloudSyncService.lastSyncedAt)
            : 'Not yet synced'}
        >
          {#if cloudSyncService.lastError}
            <span class="text-xs" style="color: var(--accent-danger)">{cloudSyncService.lastError}</span>
          {/if}
        </SettingsRow>

        <!-- Sync Now -->
        <SettingsRow label="Sync Now" description="Upload your current data to the cloud.">
          <Button
            onclick={() => cloudSyncService.upload().catch(() => {})}
            disabled={cloudSyncService.status === 'uploading' || cloudSyncService.status === 'downloading'}
          >
            {cloudSyncService.status === 'uploading' ? 'Uploading…' : 'Sync Now'}
          </Button>
        </SettingsRow>

        <!-- Restore from Cloud -->
        <SettingsRow
          label="Restore from Cloud"
          description="Replace local data with your latest cloud snapshot."
        >
          <Button
            onclick={() => cloudSyncService.restore().catch(() => {})}
            disabled={cloudSyncService.status === 'uploading' || cloudSyncService.status === 'downloading'}
          >
            {cloudSyncService.status === 'downloading' ? 'Restoring…' : 'Restore'}
          </Button>
        </SettingsRow>
      </div>
    </SettingsSection>
  {/if}
{/if}
