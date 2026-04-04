<script lang="ts">
  import { envService } from '../../services/envService';
  import { storeViewState as store } from './state.svelte';
  import { logService } from '../../services/log/logService';
  import { LoadingState, EmptyState, IconBox, StatusDot, Badge, ConfirmDialog, WarningBanner } from '../../components';

  import * as commands from '../../lib/ipc/commands'; // Import commands
  import storeExtension from './index.svelte';
  import { onMount } from 'svelte';
  import { extensionUpdateService } from '../../services/extension/extensionUpdateService.svelte';

  // Define structure for detailed API response
  interface ExtensionDetail {
    id: string;
    name: string;
    slug: string;
    description: string;
    category: string;
    status: string;
    repoUrl: string;
    installCount: number;
    iconUrl: string | null;
    createdAt: string;
    updatedAt: string;
    author: { name: string; githubUsername: string | null; avatarUrl: string | null; isVerifiedPublisher: boolean };
    version: string | null;
    asyarSdk?: string;
  }

  let extensionDetail = $state<ExtensionDetail | null>(null);
  let isLoading = $state(true);
  let isInstalled = $state(false);
  let error = $state<string | null>(null);

  let hasUpdate = $derived(extensionDetail?.id ? !!extensionUpdateService.getUpdateForExtension(extensionDetail.id) : false);
  let availableUpdate = $derived(extensionDetail?.id ? extensionUpdateService.getUpdateForExtension(extensionDetail.id) : undefined);

  let confirmUninstallOpen = $state(false);

  // Use reactive subscriptions to the store instance
  let currentSlug = $derived(store.selectedExtensionSlug);
  let extensionManager = $derived(store.extensionManager);

  $effect(() => {
    if (currentSlug) {
        fetchExtensionDetails(currentSlug);
    } else {
        extensionDetail = null;
        error = "No extension selected.";
        isLoading = false;
    }
  });

  $effect(() => {
    if (extensionDetail?.id) {
        checkIsInstalled(extensionDetail.id);
    }
  });

  async function checkIsInstalled(extensionId: string) {
    if (!extensionId) {
      isInstalled = false;
      storeExtension.notifyInstalledStateChanged(false, undefined);
      return;
    }
    try {
      const installedPaths: string[] = await commands.listInstalledExtensions();
      isInstalled = installedPaths.some(p => p.endsWith(`/${extensionId}`) || p.endsWith(`\\${extensionId}`) || p === extensionId);
      storeExtension.notifyInstalledStateChanged(isInstalled, extensionId);
    } catch (e) {
      logService?.error(`Failed to check installed status: ${e}`);
      isInstalled = false;
      storeExtension.notifyInstalledStateChanged(false, undefined);
    }
  }

  function handleStoreExtensionInstalled(e: any) {
    if (e.detail?.id === extensionDetail?.id && extensionDetail?.id) checkIsInstalled(extensionDetail.id);
    else if (e.detail?.slug === currentSlug && extensionDetail?.id) checkIsInstalled(extensionDetail.id);
  }
  function handleStoreExtensionUninstalled(e: any) {
    if (e.detail?.id === extensionDetail?.id && extensionDetail?.id) checkIsInstalled(extensionDetail.id);
    else if (e.detail?.slug === currentSlug && extensionDetail?.id) checkIsInstalled(extensionDetail.id);
  }

  onMount(() => {
    window.addEventListener('store-extension-installed', handleStoreExtensionInstalled);
    window.addEventListener('store-extension-uninstalled', handleStoreExtensionUninstalled);
    window.addEventListener('store-extension-updated', handleStoreExtensionInstalled);
    return () => {
      window.removeEventListener('store-extension-installed', handleStoreExtensionInstalled);
      window.removeEventListener('store-extension-uninstalled', handleStoreExtensionUninstalled);
      window.removeEventListener('store-extension-updated', handleStoreExtensionInstalled);
    };
  });

  async function fetchExtensionDetails(slug: string) {
    logService.debug(`[DetailView] fetchExtensionDetails START for slug: ${slug}`); // Log start
    isLoading = true;
    error = null;
    extensionDetail = null;
    logService?.info(`Fetching details for slug: ${slug}`);
    try {
      const response = await fetch(`${envService.storeApiBaseUrl}/api/extensions/${slug}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      extensionDetail = data.data || data; // Handle both wrapped and direct JSON objects
      logService.debug(`[DetailView] Successfully fetched and parsed data: ${JSON.stringify(extensionDetail)}`); // Log success and data
      logService?.info(`Fetched details for ${extensionDetail?.name}`);
    } catch (e: any) {
      logService.error(`[DetailView] Fetch error: ${e}`); // Log fetch errors
      logService?.error(`Failed to fetch extension details: ${e.message}`);
      error = `Failed to load details: ${e.message}`;
    } finally {
      isLoading = false;
      logService.debug(`[DetailView] fetchExtensionDetails FINALLY. isLoading set to false.`); // Log end
    }
  }

  async function installExtension() {
    if (!extensionDetail || !currentSlug) return;

    error = null;
    try {
      await storeExtension.installExtension(currentSlug, extensionDetail.id, extensionDetail.name);
      if (extensionDetail?.id) await checkIsInstalled(extensionDetail.id);
    } catch (e: any) {
      const errorMessage = typeof e === 'string' ? e : (e?.message || String(e));
      error = `Installation failed: ${errorMessage}`;
    }
  }


  async function uninstallExtension() {
    if (!extensionDetail || !currentSlug) return;

    error = null;
    try {
      await storeExtension.uninstallExtension(currentSlug, extensionDetail.id, extensionDetail.name);
      if (extensionDetail?.id) await checkIsInstalled(extensionDetail.id);
    } catch (e: any) {
      const errorMessage = typeof e === 'string' ? e : (e?.message || String(e));
      error = `Uninstall failed: ${errorMessage}`;
    }
  }

  async function handleUpdate() {
    if (!extensionDetail || !currentSlug) return;
    error = null;
    try {
      await storeExtension.updateExtension(currentSlug, extensionDetail.id, extensionDetail.name);
      if (extensionDetail?.id) await checkIsInstalled(extensionDetail.id);
    } catch (e: any) {
      const errorMessage = typeof e === 'string' ? e : (e?.message || String(e));
      error = `Update failed: ${errorMessage}`;
    }
  }
</script>

<div class="extension-detail-view bg-[var(--bg-primary)] overflow-y-auto h-full w-full focus:outline-none custom-scrollbar" tabindex="-1">

  {#if isLoading}
    <LoadingState message="Loading details..." />
  {:else if error}
    <div class="p-6">
      <EmptyState 
        message="Error" 
        description={error}
      >
        {#snippet icon()}
          <span style="color: var(--accent-danger);">⚠️</span>
        {/snippet}
      </EmptyState>
    </div>
  {:else if extensionDetail}
    <div class="w-full max-w-5xl mx-auto px-6 py-8 md:px-12 md:py-12">
      <!-- Header Section -->
      <div class="flex flex-col md:flex-row items-start md:items-center gap-8 mb-12">
        <IconBox size="xl" rounded="lg">
          {#snippet content()}
            {#if extensionDetail?.iconUrl}
              <img src={extensionDetail.iconUrl} alt="{extensionDetail.name} icon" class="w-full h-full object-cover">
            {:else}
              <span class="text-4xl md:text-5xl">🧩</span>
            {/if}
          {/snippet}
        </IconBox>
        
        <div class="flex-1 min-w-0">
          <h1 class="text-page-title mb-3" style="font-size: var(--font-size-3xl);">
            {extensionDetail.name}
          </h1>
          <div class="flex flex-wrap items-center gap-3 text-caption mb-6">
            <span class="flex items-center gap-1.5 text-[var(--text-primary)]">
              <span class="w-5 h-5 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px]">👤</span>
              {extensionDetail?.author?.name || 'Unknown'}
            </span>
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--separator)]"></span>
            <Badge text={extensionDetail.category} variant="default" mono />
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--separator)]"></span>
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              {extensionDetail.installCount} Installs
            </span>
          </div>

          <div class="flex items-center gap-3">
            {#if isInstalled && hasUpdate}
              <button
                onclick={handleUpdate}
                class="btn-primary p-2 h-10 px-6 flex items-center justify-center font-semibold"
              >
                Update to v{availableUpdate?.latestVersion}
              </button>
              <button
                onclick={() => confirmUninstallOpen = true}
                class="btn-danger p-2 h-10 px-5 flex items-center justify-center font-semibold"
              >
                Uninstall
              </button>
            {:else if isInstalled}
              <!-- Installed badge -->
              <span class="px-5 py-2 bg-[var(--bg-tertiary)] text-[var(--accent-success)] font-semibold text-caption rounded-lg flex items-center gap-2 border border-[var(--border-color)]">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                Installed
              </span>
              <button
                onclick={() => confirmUninstallOpen = true}
                class="btn-danger p-2 h-10 px-5 flex items-center justify-center font-semibold"
              >
                Uninstall
              </button>
            {:else}
              <button 
                onclick={installExtension} 
                class="btn-primary p-2 h-10 px-6 flex items-center justify-center font-semibold"
              >
                Install Extension
              </button>
            {/if}

            <!-- TODO: Implement actual satisfaction check against SUPPORTED_SDK_VERSION when store API provides asyarSdk -->
            {#if !isInstalled && extensionDetail?.asyarSdk}
              <WarningBanner>
                {#snippet children()}
                  <p class="text-caption">This extension requires a newer version of Asyar (SDK {extensionDetail?.asyarSdk})</p>
                {/snippet}
              </WarningBanner>
            {/if}

            {#if extensionDetail.repoUrl}
              <a href={extensionDetail.repoUrl} target="_blank" rel="noopener noreferrer" class="btn-secondary flex items-center gap-2">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" /></svg>
                GitHub
              </a>
            {/if}
          </div>
        </div>
      </div>

      <hr class="border-[var(--separator)] mb-10">

      <!-- Main Content Area -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-12">
        
        <!-- Left Column: Description & Screenshots -->
        <div class="lg:col-span-2 space-y-12">
          <section>
            <h3 class="text-section mb-4">About</h3>
            <div class="prose max-w-none text-body">
              <p>{extensionDetail?.description || 'No description provided.'}</p>
            </div>
          </section>

        </div>

        <!-- Right Column: Meta & Versions -->
        <div class="space-y-8">
          <section class="bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--separator)]">
            <h3 class="text-section mb-6">Details</h3>
            
            <dl class="space-y-4 text-caption">
              <div class="flex justify-between items-center pb-3 border-b border-[var(--separator)]">
                <dt class="text-[var(--text-secondary)] font-medium">Version</dt>
                <dd class="font-semibold text-[var(--text-primary)]">
                  {extensionDetail?.version || '1.0.0'}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-3 border-b border-[var(--separator)]">
                <dt class="text-[var(--text-secondary)] font-medium">Updated</dt>
                <dd class="font-semibold text-[var(--text-primary)]">
                  {extensionDetail?.updatedAt ? new Date(extensionDetail.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown'}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-3 border-b border-[var(--separator)]">
                <dt class="text-[var(--text-secondary)] font-medium">Status</dt>
                <dd class="font-semibold flex items-center gap-1.5 align-middle" style="color: var(--accent-success);">
                  <StatusDot color="success" />
                  {extensionDetail?.status}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-1">
                <dt class="text-[var(--text-secondary)] font-medium">Added</dt>
                <dd class="font-semibold text-[var(--text-primary)]">
                  {extensionDetail?.createdAt ? new Date(extensionDetail.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown'}
                </dd>
              </div>
            </dl>
          </section>
        </div>

      </div>
    </div>
  {:else}
    <EmptyState message="Extension details not found." />
  {/if}

  <ConfirmDialog
    bind:isOpen={confirmUninstallOpen}
    title="Uninstall extension"
    message={`Uninstall ${extensionDetail?.name}? You can reinstall it from the store.`}
    confirmButtonText="Uninstall"
    variant="danger"
    onconfirm={uninstallExtension}
  />
</div>

<style>
</style>
