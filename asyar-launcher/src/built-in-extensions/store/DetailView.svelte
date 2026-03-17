<script lang="ts">
  import { initializeStore } from './state';
  import type { INotificationService } from 'asyar-api';
  import { invoke } from '@tauri-apps/api/core'; // Import invoke

  const store = initializeStore()!;
  
  // These will be wired up via viewActivated or context if available
  let notificationService: INotificationService | null = null;

  // Define structure for detailed API response
  interface ExtensionDetail {
    id: number;
    name: string;
    slug: string;
    description: string;
    category: string;
    status: string;
    repository_url: string;
    install_count: number;
    icon_url: string;
    screenshot_urls: string[];
    created_at: string;
    updated_at: string;
    last_polled_at: string | null;
    author: { id: number; name: string };
    versions: { // More specific version structure
      id: number;
      version_string: string;
      notes: string | null;
      download_url: string;
      status: string;
      submitted_at: string;
      approved_at: string | null;
    }[];
  }

  // Define structure for install API response
  interface InstallInfo {
    download_url: string;
    version: string;
    checksum: string;
  }

  let extensionDetail: ExtensionDetail | null = null;
  let isLoading = true;
  let isInstalling = false;
  let error: string | null = null;

  // Use reactive subscriptions to the store instance
  $: currentSlug = $store.selectedExtensionSlug;
  $: extensionManager = $store.extensionManager;
  $: logService = $store.logService;

  // Reactively fetch when slug changes
  $: if (currentSlug) {
      fetchExtensionDetails(currentSlug);
  } else {
      extensionDetail = null;
      error = "No extension selected.";
      isLoading = false;
  }



  async function fetchExtensionDetails(slug: string) {
    console.log(`[DetailView] fetchExtensionDetails START for slug: ${slug}`); // Log start
    isLoading = true;
    error = null;
    extensionDetail = null;
    logService?.info(`Fetching details for slug: ${slug}`);
    try {
      const response = await fetch(`http://asyar-website.test/api/extensions/${slug}`);
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
    if (!extensionDetail || !currentSlug || isInstalling) return;

    isInstalling = true;
    error = null;
    logService?.info(`Attempting to install extension: ${extensionDetail.name} (slug: ${currentSlug})`);

    try {
      // 1. Get install info (download URL, version)
      const installInfoResponse = await fetch(`http://asyar-website.test/api/extensions/${currentSlug}/install`);
      if (!installInfoResponse.ok) {
        throw new Error(`Failed to get install info: ${installInfoResponse.status}`);
      }
      const installInfo: InstallInfo = await installInfoResponse.json();
      logService?.info(`Install info received: Version ${installInfo.version}, URL: ${installInfo.download_url}`);

      // 2. Trigger installation via ExtensionManager (or relevant service)
      // 2. Trigger installation via a Tauri command (assuming one exists)
      logService?.info(`Invoking Tauri command 'install_extension_from_url' for ${extensionDetail.name}`);
      await invoke('install_extension_from_url', {
        downloadUrl: installInfo.download_url,
        extensionId: extensionDetail.slug, // Use slug as ID? Or fetch ID separately? Assuming slug for now.
        extensionName: extensionDetail.name,
        version: installInfo.version,
        checksum: installInfo.checksum
      });

      logService?.info(`Installation command invoked successfully for ${extensionDetail.name}. App might reload extensions.`);
      notificationService?.notify({ title: 'Installation Complete', body: `${extensionDetail.name} installed successfully. Reloading extensions...` });

      // Optionally trigger a reload or wait for confirmation
      // For now, just notify. The backend command should handle the file operations and potentially trigger a reload via events.
      // Consider adding an 'Uninstall' button state here.

    } catch (e: any) {
      logService?.error(`Installation failed for ${extensionDetail.name}: ${e.message}`);
      error = `Installation failed: ${e.message}`;
      notificationService?.notify({ title: 'Installation Failed', body: `Could not install ${extensionDetail.name}. ${e.message}` });
    } finally {
      isInstalling = false;
    }
  }

  // Go back to the list view
  // Go back using the view manager's stack logic
  function goBack() {
    logService?.info('Navigating back using viewManager.goBack()');
    // No need to set slug to null here, viewManager handles the state change
    extensionManager?.goBack(); // Use the new goBack method
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
          {#if extensionDetail.icon_url}
            <img src={extensionDetail.icon_url} alt="{extensionDetail.name} icon" class="w-full h-full object-cover">
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
              {extensionDetail.install_count} Installs
            </span>
          </div>

          <div class="flex items-center gap-3">
            <button 
              on:click={installExtension} 
              disabled={isInstalling} 
              class="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold text-[13px] rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#1e1e1e] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {#if isInstalling}
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Installing...
              {:else}
                Install Extension
              {/if}
            </button>
            
            {#if extensionDetail.repository_url}
              <a href={extensionDetail.repository_url} target="_blank" rel="noopener noreferrer" class="px-4 py-2.5 bg-gray-100 dark:bg-[#252525] hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-[13px] rounded-lg transition-colors focus:outline-none flex items-center gap-2 border border-black/5 dark:border-white/5">
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

          {#if extensionDetail.screenshot_urls && extensionDetail.screenshot_urls.length > 0}
            <section>
              <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">Screenshots</h3>
              <div class="grid grid-cols-1 gap-6">
                {#each extensionDetail.screenshot_urls as screenshotUrl}
                  <div class="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm bg-gray-50 dark:bg-gray-900/50 p-2">
                    <img src={screenshotUrl} alt="Extension Screenshot" class="w-full h-auto rounded-lg">
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        </div>

        <!-- Right Column: Meta & Versions -->
        <div class="space-y-8">
          <section class="bg-gray-50/80 dark:bg-[#161616] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
            <h3 class="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-6">Details</h3>
            
            <dl class="space-y-4 text-[13px]">
              <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60">
                <dt class="text-gray-500 dark:text-gray-400 font-medium">Version</dt>
                <dd class="font-semibold text-gray-900 dark:text-white">
                  {extensionDetail.versions?.[0]?.version_string || '1.0.0'}
                </dd>
              </div>
              <div class="flex justify-between items-center pb-3 border-b border-gray-200 dark:border-gray-800/60">
                <dt class="text-gray-500 dark:text-gray-400 font-medium">Updated</dt>
                <dd class="font-semibold text-gray-900 dark:text-white">
                  {new Date(extensionDetail.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
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
                  {new Date(extensionDetail.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </dd>
              </div>
            </dl>
          </section>

          {#if extensionDetail.versions && extensionDetail.versions.length > 0}
            <section>
              <h3 class="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-6 pl-1">Version History</h3>
              <div class="relative pl-4 border-l-2 border-gray-200 dark:border-gray-800 space-y-8 ml-1">
                {#each extensionDetail.versions as version}
                  <div class="relative">
                    <div class="absolute -left-[1.35rem] mt-1 w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-600 ring-4 ring-white dark:ring-[#1e1e1e]"></div>
                    <div class="text-[13px] font-bold text-gray-900 dark:text-white">v{version.version_string}</div>
                    <div class="text-[11px] font-medium text-gray-500 mt-1 mb-1.5">{new Date(version.submitted_at).toLocaleDateString()}</div>
                    {#if version.notes}
                      <p class="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed mt-2">{version.notes}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            </section>
          {/if}
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
