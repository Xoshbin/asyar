<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { SettingsForm, SettingsFormRow, Button, SegmentedControl } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { runUpdateCheck } from '../../../services/update/updateService';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import logoUrl from '../../../resources/images/Square142x142Logo.png';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let updateStatus = $state<'idle' | 'checking' | 'downloading' | 'available' | 'up-to-date' | 'error' | 'installed'>('idle');
  let updateVersion = $state('');
  let updateError = $state('');
  let appVersion = $state('');
  let unlisten: UnlistenFn | null = null;

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

  onMount(async () => {
    try {
      appVersion = await getVersion();
    } catch {
      appVersion = '0.1.0';
    }

    unlisten = await listen('check-for-updates', () => {
      handler.activeTab = 'about';
      checkForUpdates();
    });
  });

  onDestroy(() => {
    unlisten?.();
  });

  async function checkForUpdates() {
    if (updateStatus === 'checking' || updateStatus === 'downloading') return;

    updateStatus = 'checking';
    updateError = '';
    updateVersion = '';

    const channel = handler.settings.updates?.channel ?? 'stable';
    const result = await runUpdateCheck(channel, {
      onProgress: (phase, version) => {
        updateVersion = version;
        updateStatus = phase;
      },
    });

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
    updateStatus === 'checking' ? 'Checking for updates...' :
    updateStatus === 'available' ? `Update ${updateVersion} is available. Starting download...` :
    updateStatus === 'downloading' ? `Downloading and installing update ${updateVersion}...` :
    updateStatus === 'installed' ? `Update ${updateVersion} installed. Restart Asyar to apply.` :
    updateStatus === 'up-to-date' ? "You're running the latest version." :
    updateStatus === 'error' ? `Update check failed: ${updateError}` :
    ''
  );
</script>

<div class="app-header">
  <img src={logoUrl} alt="Asyar" class="app-logo" />
  <div class="app-name">Asyar</div>
  <div class="app-version">Version {appVersion}</div>
</div>

<SettingsForm>
  <SettingsFormRow
    label="Release Channel"
    description="Stable: tested releases only. Beta: early access to pre-release versions."
  >
    <SegmentedControl
      options={[
        { value: 'stable', label: 'Stable' },
        { value: 'beta', label: 'Beta' },
      ]}
      bind:value={selectedChannel}
    />
  </SettingsFormRow>

  <SettingsFormRow label="Updates" separator>
    <div class="update-control">
      <Button
        onclick={checkForUpdates}
        disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
      >
        {updateStatus === 'checking' || updateStatus === 'downloading' ? 'Checking...' : 'Check for Updates'}
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
  </SettingsFormRow>

  <SettingsFormRow label="Created by" separator>
    <span class="info-text">Khoshbin Ali</span>
  </SettingsFormRow>

  <SettingsFormRow label="Built with">
    <span class="info-text">Tauri, Rust, Svelte, TypeScript</span>
  </SettingsFormRow>

  <SettingsFormRow label="">
    <div class="links-row">
      <Button onclick={() => openUrl('https://github.com/Xoshbin/asyar-launcher')}>GitHub</Button>
      <Button>Privacy Policy</Button>
      <Button>License</Button>
    </div>
  </SettingsFormRow>
</SettingsForm>

<style>
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
