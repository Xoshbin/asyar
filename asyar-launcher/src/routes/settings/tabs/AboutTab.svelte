<script lang="ts">
  import { SettingsCard, SettingsRow, Button, SegmentedControl, Toggle } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { runUpdateCheck } from '../../../services/update/updateService';
  import { appUpdateState } from '../../../services/update/appUpdateStore.svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { appRelaunch } from '../../../lib/ipc/commands';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import logoUrl from '../../../resources/images/Square142x142Logo.png';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let updateStatus = $state<
    'idle' | 'checking' | 'downloading' | 'available' | 'up-to-date' | 'error' | 'installed'
  >('idle');
  let updateVersion = $state('');
  let updateError = $state('');
  let appVersion = $state('');

  let selectedChannel = $state<'stable' | 'beta'>('stable');
  $effect(() => {
    selectedChannel = handler.settings.updates?.channel ?? 'stable';
  });
  $effect(() => {
    const current = handler.settings.updates?.channel ?? 'stable';
    if (selectedChannel !== current) {
      handler.updateChannel(selectedChannel as 'stable' | 'beta');
    }
  });

  $effect(() => {
    getVersion()
      .then((v) => {
        appVersion = v;
      })
      .catch(() => {
        appVersion = '0.1.0';
      });

    let unlisten: UnlistenFn | undefined;
    listen('check-for-updates', () => {
      handler.activeTab = 'about';
      checkForUpdates();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  });

  async function checkForUpdates() {
    if (updateStatus === 'checking' || updateStatus === 'downloading') return;

    updateStatus = 'checking';
    updateError = '';
    updateVersion = '';

    const result = await runUpdateCheck();

    if (result.kind === 'installed') {
      updateVersion = result.version;
      updateStatus = 'installed';
    } else if (result.kind === 'up-to-date') {
      updateStatus = 'up-to-date';
    } else if (result.kind === 'error') {
      updateStatus = 'error';
      updateError = result.message;
    } else {
      updateStatus = 'idle';
    }
  }

  let updateStatusText = $derived(
    updateStatus === 'checking'
      ? 'Checking for updates...'
      : updateStatus === 'available'
        ? `Update ${updateVersion} is available. Starting download...`
        : updateStatus === 'downloading'
          ? `Downloading and installing update ${updateVersion}...`
          : updateStatus === 'installed'
            ? `Update ${updateVersion} installed. Restart Asyar to apply.`
            : updateStatus === 'up-to-date'
              ? "You're running the latest version."
              : updateStatus === 'error'
                ? `Update check failed: ${updateError}`
                : '',
  );

  async function restartAndUpdate() {
    await appRelaunch();
  }
</script>

<div class="about-tab">
  <div id="about-updates" class="anchor-group">
    <div class="section-header">Updates</div>
    <SettingsCard>
      <div class="app-header">
        <img src={logoUrl} alt="Asyar" class="app-logo" />
        <div class="app-name">Asyar</div>
        <div class="app-version">Version {appVersion}</div>
      </div>

      <SettingsRow
        label="Release channel"
        description="Stable: tested releases only. Beta: early access to pre-release versions."
      >
        {#snippet children()}
          <SegmentedControl
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'beta', label: 'Beta' },
            ]}
            bind:value={selectedChannel}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label="Automatic updates"
        description="Check for and download updates in the background."
      >
        {#snippet children()}
          <Toggle
            checked={handler.settings.updates?.autoCheck ?? true}
            onchange={(e) => handler.updateAutoCheck((e.currentTarget as HTMLInputElement).checked)}
          />
        {/snippet}
      </SettingsRow>

      {#if appUpdateState.phase === 'ready'}
        <SettingsRow
          label={`Update ${appUpdateState.pendingVersion} ready`}
          description="Will install automatically on next launch."
        >
          {#snippet children()}
            <Button onclick={restartAndUpdate}>Restart Now</Button>
          {/snippet}
        </SettingsRow>
      {/if}

      <SettingsRow label="Updates">
        {#snippet children()}
          <div class="update-control">
            <Button
              onclick={checkForUpdates}
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
            >
              {updateStatus === 'checking' || updateStatus === 'downloading'
                ? 'Checking...'
                : 'Check for Updates'}
            </Button>
            {#if updateStatus !== 'idle'}
              <span
                class="update-status"
                class:status-success={updateStatus === 'up-to-date' || updateStatus === 'installed'}
                class:status-error={updateStatus === 'error'}
              >
                {updateStatusText}
              </span>
            {/if}
          </div>
        {/snippet}
      </SettingsRow>
    </SettingsCard>
  </div>

  <div id="about-credits" class="anchor-group">
    <div class="section-header">Credits</div>
    <SettingsCard>
      <SettingsRow label="Created by">
        {#snippet children()}
          <span class="info-text">Khoshbin Ali</span>
        {/snippet}
      </SettingsRow>

      <SettingsRow label="Built with">
        {#snippet children()}
          <span class="info-text">Tauri, Rust, Svelte, TypeScript</span>
        {/snippet}
      </SettingsRow>
    </SettingsCard>
  </div>

  <div id="about-links" class="anchor-group">
    <div class="section-header">Links</div>
    <SettingsCard>
      <SettingsRow label="Project links" description="Open source, policies, and license details.">
        {#snippet children()}
          <div class="links-row">
            <Button onclick={() => openUrl('https://github.com/Xoshbin/asyar-launcher')}>
              GitHub
            </Button>
            <Button onclick={() => openUrl('https://discord.gg/vvYRXrs7Xa')}>Discord</Button>
            <Button onclick={() => openUrl('https://asyar.org/privacy')}>Privacy Policy</Button>
            <Button onclick={() => openUrl('https://github.com/Xoshbin/asyar/blob/main/LICENSE')}>
              License
            </Button>
          </div>
        {/snippet}
      </SettingsRow>
    </SettingsCard>
  </div>
</div>

<style>
  .about-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .anchor-group {
    scroll-margin-top: var(--space-6);
  }

  .app-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-8) var(--space-6) var(--space-6);
    border-bottom: 1px solid var(--separator);
  }

  .app-logo {
    width: 72px;
    height: 72px;
    border-radius: var(--radius-xl);
  }

  .app-name {
    margin-top: var(--space-3);
    font-size: var(--font-size-lg);
    font-weight: 700;
    font-family: var(--font-ui);
    color: var(--text-primary);
  }

  .app-version {
    margin-top: var(--space-1);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
    user-select: none;
  }

  .update-control {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .update-status {
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
    color: var(--accent-primary);
  }

  .update-status.status-success {
    color: var(--accent-success);
  }

  .update-status.status-error {
    color: var(--accent-danger);
  }

  .info-text {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-primary);
  }

  .links-row {
    display: flex;
    gap: var(--space-2);
  }
</style>
