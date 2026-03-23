<script lang="ts">
  import { envService } from '../../services/envService';
  import { initializeStore } from './state';

  import { invoke } from '@tauri-apps/api/core'; // Import invoke
  import storeExtension from './index';
  import { onMount, onDestroy } from 'svelte';

  const store = initializeStore()!;
  
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
  }

  let extensionDetail: ExtensionDetail | null = null;
  let isLoading = true;
  let isInstalled = false;
  let error: string | null = null;

  // Use reactive subscriptions to the store instance
  $: currentSlug = $store.selectedExtensionSlug;
  $: extensionManager = $store.extensionManager;
  $: logService = $store.logService;

  $: if (currentSlug) {
      fetchExtensionDetails(currentSlug);
  } else {
      extensionDetail = null;
      error = "No extension selected.";
      isLoading = false;
  }

  $: if (extensionDetail?.id) {
      checkIsInstalled(extensionDetail.id);
  }

  async function checkIsInstalled(extensionId: string) {
    if (!extensionId) {
      isInstalled = false;
      storeExtension.notifyInstalledStateChanged(false, undefined);
      return;
    }
    try {
      const installedPaths: string[] = await invoke('list_installed_extensions');
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
  });

  onDestroy(() => {
    window.removeEventListener('store-extension-installed', handleStoreExtensionInstalled);
    window.removeEventListener('store-extension-uninstalled', handleStoreExtensionUninstalled);
  });



  async function fetchExtensionDetails(slug: string) {
    console.log(`[DetailView] fetchExtensionDetails START for slug: ${slug}`); // Log start
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
      console.log('[DetailView] Successfully fetched and parsed data:', extensionDetail); // Log success and data
      logService?.info(`Fetched details for ${extensionDetail?.name}`);
    } catch (e: any) {
      console.error('[DetailView] Fetch error:', e); // Log fetch errors
      logService?.error(`Failed to fetch extension details: ${e.message}`);
      error = `Failed to load details: ${e.message}`;
    } finally {
      isLoading = false;
      console.log(`[DetailView] fetchExtensionDetails FINALLY. isLoading set to false.`); // Log end
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

  // Go back using the view manager's stack logic
  function goBack() {
    logService?.info('Navigating back using viewManager.goBack()');
    // No need to set slug to null here, viewManager handles the state change
    extensionManager?.goBack(); // Use the new goBack method
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

</script>

<div class="extension-detail-view bg-white dark:bg-[#1e1e1e] overflow-y-auto h-full w-full focus:outline-none custom-scrollbar" tabindex="-1">
  
  <!-- Back navigation header -->
  <div class="sticky top-0 z-20 flex items-center px-6 py-4 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
    <button on:click={goBack} class="group flex items-center text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 px-3 py-1.5 rounded-md">
      <svg class="w-4 h-4 mr-1.5 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/></svg>
      Store
    </button>
  </div>

  {#if isLoading}
    <div class="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500 font-medium text-sm">Loading details...</div>
  {:else if error}
    <div class="p-6">
      <div class="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm border border-red-100 dark:border-red-900/30">
        {error}
      </div>
    </div>
  {:else if extensionDetail}
    <div class="w-full max-w-5xl mx-auto px-6 py-8 md:px-12 md:py-12">
      <!-- Header Section -->
      <div class="flex flex-col md:flex-row items-start md:items-center gap-8 mb-12">
        <div class="flex-shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-gray-50 dark:bg-gray-900/50 flex items-center justify-center overflow-hidden border border-gray-100 dark:border-gray-800 shadow-sm">
          {#if extensionDetail.iconUrl}
            <img src={extensionDetail.iconUrl} alt="{extensionDetail.name} icon" class="w-full h-full object-cover">
          {:else}
            <span class="text-4xl md:text-5xl">🧩</span>
          {/if}
        </div>
        
        <div class="flex-1 min-w-0">
          <h1 class="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3 leading-tight tracking-tight">
            {extensionDetail.name}
          </h1>
          <div class="flex flex-wrap items-center gap-3 text-[13px] text-gray-500 dark:text-gray-400 mb-6 font-medium">
            <span class="flex items-center gap-1.5 text-gray-700 dark:text-gray-200">
              <span class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px]">👤</span>
              {extensionDetail.author.name}
            </span>
            <span class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>
            <span>{extensionDetail.category}</span>
            <span class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              {extensionDetail.installCount} Installs
            </span>
          </div>

          <div class="flex items-center gap-3">
            {#if isInstalled}
              <!-- Installed badge -->
              <span class="px-5 py-2.5 bg-green-50/80 dark:bg-green-900/10 text-green-600 dark:text-green-400 font-semibold text-[13px] rounded-lg shadow-sm flex items-center gap-2 border border-green-200/60 dark:border-green-800/50">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                Installed
              </span>
              <button
                on:click={uninstallExtension}
                class="px-5 py-2.5 bg-white dark:bg-[#1e1e1e] hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 font-semibold text-[13px] rounded-lg border border-gray-200 dark:border-gray-800 hover:border-red-200 dark:hover:border-red-800/50 transition-colors focus:outline-none flex items-center gap-2 shadow-sm"
              >
                Uninstall
              </button>
            {:else}
              <button 
                on:click={installExtension} 
                class="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold text-[13px] rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#1e1e1e] flex items-center gap-2"
              >
                Install Extension
              </button>
            {/if}
            {#if extensionDetail.repoUrl}
              <a href={extensionDetail.repoUrl} target="_blank" rel="noopener noreferrer" class="px-4 py-2.5 bg-gray-100 dark:bg-[#252525] hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-[13px] rounded-lg transition-colors focus:outline-none flex items-center gap-2 border border-black/5 dark:border-white/5">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" /></svg>
                GitHub
              </a>
            {/if}
          </div>
        </div>
      </div>

      <hr class="border-gray-100 dark:border-gray-800 mb-10">

      <!-- Main Content Area -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-12">
        
        <!-- Left Column: Description & Screenshots -->
        <div class="lg:col-span-2 space-y-12">
          <section>
            <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">About</h3>
            <div class="prose dark:prose-invert max-w-none text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
              <p>{extensionDetail.description}</p>
            </div>
          </section>

        </div>

        <!-- Right Column: Meta & Versions -->
        <div class="space-y-8">
          <section class="bg-gray-50/80 dark:bg-[#161616] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
            <h3 class="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-6">Details</h3>
            
            <dl class="space-y-4 text-[13px]">
              <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60">
                <dt class="text-gray-500 dark:text-gray-400 font-medium">Version</dt>
                <dd class="font-semibold text-gray-900 dark:text-white">
                  {extensionDetail.version || '1.0.0'}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60">
                <dt class="text-gray-500 dark:text-gray-400 font-medium">Updated</dt>
                <dd class="font-semibold text-gray-900 dark:text-white">
                  {new Date(extensionDetail.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60">
                <dt class="text-gray-500 dark:text-gray-400 font-medium">Status</dt>
                <dd class="font-semibold text-green-600 dark:text-green-400 flex items-center gap-1.5 align-middle">
                  <span class="w-2 h-2 rounded-full bg-green-500"></span>
                  {extensionDetail.status}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-1">
                <dt class="text-gray-500 dark:text-gray-400 font-medium">Added</dt>
                <dd class="font-semibold text-gray-900 dark:text-white">
                  {new Date(extensionDetail.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </dd>
              </div>
            </dl>
          </section>
        </div>

      </div>
    </div>
  {:else}
    <div class="flex items-center justify-center h-64 text-gray-400">Extension details not found.</div>
  {/if}
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(150, 150, 150, 0.2);
    border-radius: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(150, 150, 150, 0.4);
  }
</style>
