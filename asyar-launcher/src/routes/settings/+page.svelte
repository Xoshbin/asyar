<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { 
    TabGroup, 
    LoadingState, 
    ConfirmDialog 
  } from '../../components';
  import { SettingsHandler } from './settingsHandlers.svelte';
  import GeneralTab from './tabs/GeneralTab.svelte';
  import ShortcutsTab from './tabs/ShortcutsTab.svelte';
  import AppearanceTab from './tabs/AppearanceTab.svelte';
  import ExtensionsTab from './tabs/ExtensionsTab.svelte';
  import AboutTab from './tabs/AboutTab.svelte';
  import BackupTab from './tabs/BackupTab.svelte';
  import AccountTab from './tabs/AccountTab.svelte';
  import { authService } from '../../services/auth/authService.svelte';
import { registerProfileProviders } from '../../services/appInitializer';
import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';


  import '../../resources/styles/style.css';

  const handler = new SettingsHandler();

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'extensions', label: 'Extensions' },
    { id: 'backup', label: 'Backup' },
    { id: 'account', label: 'Account' },
    { id: 'about', label: 'About' },

  ];

  onMount(async () => {
    handler.init();
    await authService.init();
    registerProfileProviders(); // needed for sync operations in settings window
    cloudSyncService.checkStatus().catch(() => {}); // populate lastSyncedAt display
  });


  onDestroy(() => {
    handler.destroy();
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
  {#if handler.initError}
    <div class="fixed top-0 left-0 right-0 p-2 text-center z-50" style="background: color-mix(in srgb, var(--accent-warning) 15%, var(--bg-primary)); color: var(--text-primary);">
      ⚠️ {handler.initError}
    </div>
  {/if}
  
  <div class="container mx-auto p-6 max-w-5xl h-screen pt-{handler.initError ? '12' : '6'}">
    <div class="flex gap-8 h-full">
      <!-- Sidebar Navigation -->
      <aside class="w-56 flex-shrink-0 overflow-y-auto">
        <nav class="sticky top-6">
          <TabGroup
            tabs={tabs}
            bind:activeTab={handler.activeTab}
            variant="sidebar"
          />
        </nav>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 custom-scrollbar space-y-6 overflow-y-auto pb-6">
        {#if handler.activeTab === 'general'}
              <GeneralTab {handler} />
            {:else if handler.activeTab === 'shortcuts'}
              <ShortcutsTab {handler} />
            {:else if handler.activeTab === 'appearance'}
              <AppearanceTab {handler} />
            {:else if handler.activeTab === 'extensions'}
              <ExtensionsTab {handler} />
            {:else if handler.activeTab === 'backup'}
              <BackupTab {handler} />
            {:else if handler.activeTab === 'account'}
              <AccountTab {handler} />
            {:else if handler.activeTab === 'about'}
              <AboutTab {handler} />

            {/if}
      </main>
    </div>
  </div>
{/if}

<!-- Uninstall confirmation dialog -->
<ConfirmDialog
  bind:isOpen={handler.uninstallDialogOpen}
  title="Uninstall Extension"
  message={`Are you sure you want to uninstall "${handler.extensionToUninstall?.title}"? This action cannot be undone.`}
  confirmButtonText="Uninstall"
  onconfirm={() => handler.uninstallExtension()}
/>
