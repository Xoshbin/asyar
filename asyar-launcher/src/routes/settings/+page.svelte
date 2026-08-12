<!-- src/routes/settings/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    LoadingState,
    DialogHost,
    SettingsCommandBar,
    SettingsSectionNav,
    SettingsSearchResults,
    TabGroup,
  } from '../../components';
  import { SettingsHandler } from './settingsHandlers.svelte';
  import {
    SETTINGS_TABS,
    SETTINGS_SEARCH_INDEX,
    SECTION_ANCHORS,
    buildSearchResults,
    type SettingsSearchEntry,
  } from './settingsNavRegistry';
  import GeneralTab from './tabs/GeneralTab.svelte';
  import AiTab from './tabs/AiTab.svelte';
  import ApplicationsTab from './tabs/ApplicationsTab.svelte';
  import FileSearchTab from './tabs/FileSearchTab.svelte';
  import ScriptsTab from './tabs/ScriptsTab.svelte';
  import ExtensionsTab from './tabs/ExtensionsTab.svelte';
  import AboutTab from './tabs/AboutTab.svelte';
  import BackupTab from './tabs/BackupTab.svelte';
  import AccountTab from './tabs/AccountTab.svelte';
  import AdvancedTab from './tabs/AdvancedTab.svelte';
  import DeveloperTab from './tabs/DeveloperTab.svelte';
  import PrivacyTab from './tabs/PrivacyTab.svelte';
  import BrowsersTab from './tabs/BrowsersTab.svelte';
  import { authService } from '../../services/auth/authService.svelte';
  import { registerProfileProviders } from '../../services/appInitializer';
  import { initProviders } from '../../services/ai/initProviders';
  import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';
  import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';
  import { initValidKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
  import { listen } from '@tauri-apps/api/event';

  import '../../resources/styles/style.css';

  // Settings is a separate webview window — register AI providers locally
  // before AiTab reads the provider registry.
  initProviders();

  const handler = new SettingsHandler();

  const settingsTabs = $derived(
    SETTINGS_TABS.filter((t) => !t.developerOnly || handler.settings.developer?.enabled),
  );

  const query = $derived(handler.searchQuery);
  const searching = $derived(query.trim().length > 0);
  const searchResults = $derived(buildSearchResults(SETTINGS_SEARCH_INDEX, settingsTabs, query));

  const currentAnchors = $derived(SECTION_ANCHORS[handler.activeTab] ?? []);

  // Switching tabs (sidebar click, or the asyar:navigate-settings-tab event)
  // must leave the search-results view — otherwise the results list stays up
  // and the sidebar looks inert. selectSearchResult clears the query itself;
  // the redundant clear this effect performs afterwards is a no-op.
  let previousActiveTab = handler.activeTab;
  $effect(() => {
    if (handler.activeTab !== previousActiveTab) {
      previousActiveTab = handler.activeTab;
      handler.searchQuery = '';
    }
  });

  let contentEl = $state<HTMLElement | undefined>();

  function selectSearchResult(entry: SettingsSearchEntry) {
    handler.activeTab = entry.tab;
    handler.searchQuery = '';
    if (entry.sectionAnchor) {
      // Wait one frame for the pane switch to mount before scrolling.
      requestAnimationFrame(() => {
        const target = document.getElementById(entry.sectionAnchor!);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (target) {
          target.classList.add('settings-search-highlight');
          setTimeout(() => target.classList.remove('settings-search-highlight'), 1200);
        }
      });
    }
  }

  let unlistenNavTab: (() => void) | undefined;

  onMount(async () => {
    handler.init();
    await authService.init();
    await shortcutStore.init();
    await initValidKeys();
    registerProfileProviders();
    cloudSyncService.checkStatus().catch(() => {});
    unlistenNavTab = await listen<{ tab: string; extensionId?: string | null }>(
      'asyar:navigate-settings-tab',
      (e) => {
        handler.activeTab = e.payload.tab;
        if (e.payload.extensionId) {
          handler.pendingExtensionSelection = e.payload.extensionId;
        }
      },
    );
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
  <div class="settings-shell">
    {#if handler.initError}
      <div
        class="p-2 text-center"
        style="background: color-mix(in srgb, var(--accent-warning) 15%, var(--bg-primary)); color: var(--text-primary);"
      >
        ⚠️ {handler.initError}
      </div>
    {/if}

    <SettingsCommandBar bind:query={handler.searchQuery} />

    <div class="settings-body">
      <aside class="settings-sidebar custom-scrollbar">
        <TabGroup tabs={settingsTabs} bind:activeTab={handler.activeTab} variant="sidebar" />
      </aside>

      <div class="settings-content-column">
        {#if searching}
          <SettingsSearchResults {query} results={searchResults} onSelect={selectSearchResult} />
        {:else}
          {#if currentAnchors.length > 0}
            <SettingsSectionNav sections={currentAnchors} scrollRoot={contentEl ?? null} />
          {/if}

          <main
            bind:this={contentEl}
            class="settings-content custom-scrollbar"
            class:full-bleed={handler.activeTab === 'extensions'}
          >
            <div
              class="settings-content-inner"
              class:full-bleed-inner={handler.activeTab === 'extensions'}
              class:wide-inner={handler.activeTab === 'applications'}
            >
              {#if handler.activeTab === 'general'}
                <GeneralTab {handler} />
              {:else if handler.activeTab === 'ai'}
                <AiTab {handler} />
              {:else if handler.activeTab === 'extensions'}
                <ExtensionsTab {handler} />
              {:else if handler.activeTab === 'browsers'}
                <BrowsersTab />
              {:else if handler.activeTab === 'applications'}
                <ApplicationsTab />
              {:else if handler.activeTab === 'file-search'}
                <FileSearchTab />
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
        {/if}
      </div>
    </div>
  </div>
{/if}

<DialogHost />

<style>
  .settings-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
  }

  .settings-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .settings-sidebar {
    width: 238px;
    flex-shrink: 0;
    background: var(--bg-primary);
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
    padding: var(--space-3) var(--space-3) var(--space-6);
  }

  .settings-content-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: var(--space-8) var(--space-8) var(--space-10);
  }

  .settings-content.full-bleed {
    padding: 0;
    overflow: hidden;
  }

  .settings-content-inner {
    max-width: 820px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .settings-content-inner.full-bleed-inner {
    max-width: none;
    margin: 0;
    height: 100%;
    gap: 0;
  }

  .settings-content-inner.wide-inner {
    max-width: 900px;
  }

  :global(.settings-search-highlight) {
    animation: settings-search-highlight-pulse 1.2s ease-out;
  }

  @keyframes settings-search-highlight-pulse {
    0% {
      box-shadow: 0 0 0 2px var(--accent-primary);
    }
    100% {
      box-shadow: 0 0 0 2px transparent;
    }
  }
</style>
