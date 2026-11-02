<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { LoadingState } from '../../components';
  import SettingsSidebar from '../../components/settings/SettingsSidebar.svelte';
  import { searchSettings, type SettingsSearchResult } from './settingsSearch';
  import { resolveNavigation, SETTINGS_TAB_KEYWORDS, type SettingsTabId } from './settingsNav';
  import { SettingsHandler } from './settingsHandlers.svelte';
  import GeneralTab from './tabs/GeneralTab.svelte';
  import ExtensionsTab from './tabs/ExtensionsTab.svelte';
  import BuiltInFeaturesTab from './tabs/BuiltInFeaturesTab.svelte';
  import AboutTab from './tabs/AboutTab.svelte';
  import BackupTab from './tabs/BackupTab.svelte';
  import AccountTab from './tabs/AccountTab.svelte';
  import AdvancedTab from './tabs/AdvancedTab.svelte';
  import DeveloperTab from './tabs/DeveloperTab.svelte';
  import PrivacyTab from './tabs/PrivacyTab.svelte';
  import ApplicationsTab from './tabs/ApplicationsTab.svelte';
  import { authService } from '../../services/auth/authService.svelte';
  import { registerProfileProviders } from '../../services/appInitializer';
  import { initProviders } from '../../services/ai/initProviders';
  import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';
  import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';
  import { snippetStore } from '../../built-in-features/snippets/snippetStore.svelte';
  import { noteStore } from '../../built-in-features/notes/noteStore.svelte';
  import { portalStore } from '../../built-in-features/portals/portalStore.svelte';
  import { initValidKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import { listen } from '@tauri-apps/api/event';
  import { i18nService, t } from '../../services/i18n';
  import {
    initAppUpdateStore,
    destroyAppUpdateStore,
  } from '../../services/update/appUpdateStore.svelte';

  import '../../resources/styles/style.css';

  // Settings is a separate webview window — register AI providers locally
  // before AiTab reads the provider registry.
  initProviders();

  const handler = new SettingsHandler();

  let sidebarQuery = $state('');

  const searchResults = $derived(
    searchSettings(sidebarQuery, handler.extensions, handler.settings.developer?.enabled === true),
  );

  function openSearchResult(result: { id: string }) {
    const hit = searchResults.find((r: SettingsSearchResult) => r.id === result.id);
    if (!hit) return;
    handler.activeTab = hit.target.tab;
    handler.pendingExtensionSelection = hit.target.extensionId ?? null;
    sidebarQuery = '';
  }

  const settingsTabs = $derived(
    (
      [
        { id: 'account', label: t('settings.tabs.account'), icon: 'user', group: 'top' },
        { id: 'general', label: t('settings.tabs.general'), icon: 'settings', group: 'app' },
        {
          id: 'applications',
          label: t('settings.tabs.applications'),
          icon: 'layers',
          group: 'app',
        },
        {
          id: 'built-in-features',
          label: t('settings.tabs.built_in_features'),
          icon: 'layers',
          group: 'app',
          count: handler.extensions.filter((e) => e.isBuiltIn).length,
        },
        {
          id: 'extensions',
          label: t('settings.tabs.extensions'),
          icon: 'puzzle',
          group: 'app',
          count: handler.extensions.filter((e) => !e.isBuiltIn).length,
        },
        { id: 'privacy', label: t('settings.tabs.privacy'), icon: 'lock', group: 'app' },
        { id: 'backup', label: t('settings.tabs.backup'), icon: 'cloud-upload', group: 'app' },
        { id: 'advanced', label: t('settings.tabs.advanced'), icon: 'dev-tools', group: 'system' },
        ...(handler.settings.developer?.enabled
          ? [
              {
                id: 'developer',
                label: t('settings.tabs.developer'),
                icon: 'dev-tools',
                group: 'system',
              },
            ]
          : []),
        { id: 'about', label: t('settings.tabs.about'), icon: 'info', group: 'system' },
      ] as {
        id: SettingsTabId;
        label: string;
        icon: string;
        group: 'top' | 'app' | 'system';
        count?: number;
        badge?: string;
      }[]
    ).map((tab) => ({ ...tab, keywords: SETTINGS_TAB_KEYWORDS[tab.id] })),
  );

  // Developer Mode turned off while on the Developer tab: don't leave a blank pane.
  $effect(() => {
    if (handler.activeTab === 'developer' && !handler.settings.developer?.enabled) {
      handler.activeTab = 'advanced';
    }
  });

  let unlistenNavTab: (() => void) | undefined;

  onMount(async () => {
    void i18nService.init();
    handler.init();
    await authService.init();
    await Promise.all([
      shortcutStore.init(),
      snippetStore.init(),
      noteStore.init(),
      portalStore.init(),
    ]);
    await initValidKeys();
    registerProfileProviders();
    cloudSyncService.checkStatus().catch(() => {});
    void initAppUpdateStore();
    unlistenNavTab = await listen<{ tab: string; extensionId?: string | null }>(
      'asyar:navigate-settings-tab',
      (e) => {
        const target = resolveNavigation(e.payload, handler.settings.developer?.enabled === true);
        handler.activeTab = target.tab;
        handler.pendingExtensionSelection = target.extensionId;
      },
    );
  });

  onDestroy(() => {
    handler.destroy();
    unlistenNavTab?.();
    destroyAppUpdateStore();
  });
</script>

<svelte:head>
  <title>{t('settings.page_title')}</title>
</svelte:head>

{#if handler.isLoading}
  <div class="flex items-center justify-center h-screen">
    <LoadingState message={t('settings.loading')} />
  </div>
{:else}
  <div class="settings-page">
    <SettingsSidebar
      tabs={settingsTabs}
      bind:activeTab={handler.activeTab}
      bind:query={sidebarQuery}
      accountUser={authService.user}
      results={searchResults}
      onresult={openSearchResult}
    />

    <div class="settings-main">
      {#if handler.initError}
        <div
          class="p-2 text-center"
          style="background: color-mix(in srgb, var(--accent-warning) 15%, var(--bg-primary)); color: var(--text-primary);"
        >
          ⚠️ {handler.initError}
        </div>
      {/if}

      <main class="settings-content custom-scrollbar">
        <div class="settings-content-inner">
          {#if handler.activeTab === 'general'}
            <GeneralTab {handler} />
          {:else if handler.activeTab === 'applications'}
            <ApplicationsTab />
          {:else if handler.activeTab === 'built-in-features'}
            <BuiltInFeaturesTab {handler} />
          {:else if handler.activeTab === 'extensions'}
            <ExtensionsTab {handler} />
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
  </div>
{/if}

<style>
  .settings-page {
    display: flex;
    flex-direction: row;
    height: 100vh;
    background: var(--bg-primary);
  }

  .settings-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5) var(--space-6);
  }

  .settings-content-inner {
    max-width: 820px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
</style>
