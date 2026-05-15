<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    LoadingState,
    DialogHost,
    SettingsTopBar
  } from '../../components';
  import { SettingsHandler } from './settingsHandlers.svelte';
  import GeneralTab from './tabs/GeneralTab.svelte';
  import AiTab from './tabs/AiTab.svelte';
  import ApplicationsTab from './tabs/ApplicationsTab.svelte';
  import ScriptsTab from './tabs/ScriptsTab.svelte';
  import ExtensionsTab from './tabs/ExtensionsTab.svelte';
  import AboutTab from './tabs/AboutTab.svelte';
  import BackupTab from './tabs/BackupTab.svelte';
  import AccountTab from './tabs/AccountTab.svelte';
  import AdvancedTab from './tabs/AdvancedTab.svelte';
  import DeveloperTab from './tabs/DeveloperTab.svelte';
  import PrivacyTab from './tabs/PrivacyTab.svelte';
  import { authService } from '../../services/auth/authService.svelte';
  import { registerProfileProviders } from '../../services/appInitializer';
  import { initProviders } from '../../services/ai/initProviders';
  import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';
  import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';
  import { initValidKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import { listen } from '@tauri-apps/api/event';

  import '../../resources/styles/style.css';

  // Settings is a separate webview window — register AI providers locally
  // before AiTab calls listProviders().
  initProviders();

  const handler = new SettingsHandler();

  const settingsTabs = $derived([
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'extensions', label: 'Extensions', icon: 'puzzle' },
    { id: 'applications', label: 'Applications', icon: 'layers' },
    { id: 'scripts', label: 'Scripts', icon: 'dev-tools' },
    { id: 'ai', label: 'AI', icon: 'ai-chat' },
    { id: 'backup', label: 'Backup', icon: 'cloud-upload' },
    { id: 'account', label: 'Account', icon: 'user' },
    { id: 'privacy', label: 'Privacy', icon: 'lock' },
    { id: 'advanced', label: 'Advanced', icon: 'layers' },
    ...(handler.settings.developer?.enabled
      ? [{ id: 'developer', label: 'Developer', icon: 'dev-tools' }]
      : []),
    { id: 'about', label: 'About', icon: 'info' },
  ]);

  let unlistenNavTab: (() => void) | undefined;

  onMount(async () => {
    handler.init();
    await authService.init();
    await shortcutStore.init();
    await initValidKeys();
    registerProfileProviders();
    cloudSyncService.checkStatus().catch(() => {});
    unlistenNavTab = await listen<{ tab: string }>('asyar:navigate-settings-tab', (e) => {
      handler.activeTab = e.payload.tab;
    });
  });

  onDestroy(() => {
    handler.destroy();
    unlistenNavTab?.();
  });
</script>

<svelte:head>
  <title>Asyar Settings</title>
</svelte:head>

{#if handler.isLoading}
  <div class="flex items-center justify-center h-screen">
    <LoadingState message="Loading settings..." />
  </div>
{:else}
  <div class="settings-page">
    <header class="settings-header">
      {#if handler.initError}
        <div class="p-2 text-center" style="background: color-mix(in srgb, var(--accent-warning) 15%, var(--bg-primary)); color: var(--text-primary);">
          ⚠️ {handler.initError}
        </div>
      {/if}
      <SettingsTopBar tabs={settingsTabs} bind:activeTab={handler.activeTab} />
    </header>

    <main class="settings-content custom-scrollbar" class:full-bleed={handler.activeTab === 'extensions'}>
      <div class="settings-content-inner" class:full-bleed-inner={handler.activeTab === 'extensions'}>
        {#if handler.activeTab === 'general'}
          <GeneralTab {handler} />
        {:else if handler.activeTab === 'ai'}
          <AiTab {handler} />
        {:else if handler.activeTab === 'extensions'}
          <ExtensionsTab {handler} />
        {:else if handler.activeTab === 'applications'}
          <ApplicationsTab />
        {:else if handler.activeTab === 'scripts'}
          <ScriptsTab />
        {:else if handler.activeTab === 'backup'}
          <BackupTab {handler} />
        {:else if handler.activeTab === 'account'}
          <AccountTab {handler} />
        {:else if handler.activeTab === 'privacy'}
          <PrivacyTab />
        {:else if handler.activeTab === 'advanced'}
          <AdvancedTab {handler} />
        {:else if handler.activeTab === 'developer'}
          <DeveloperTab {handler} />
        {:else if handler.activeTab === 'about'}
          <AboutTab {handler} />
        {/if}
      </div>
    </main>
  </div>
{/if}

<DialogHost />

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
  }

  .settings-header {
    flex-shrink: 0;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5) var(--space-6);
  }

  .settings-content.full-bleed {
    padding: 0;
    overflow: hidden;
  }

  .settings-content-inner {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .settings-content-inner.full-bleed-inner {
    max-width: none;
    margin: 0;
    height: 100%;
    gap: 0;
  }
</style>
