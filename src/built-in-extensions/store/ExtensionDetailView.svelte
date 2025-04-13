<script lang="ts">
  import { onMount, getContext, onDestroy } from 'svelte';
  import { storeViewState } from './state'; // Import the whole store state object
  import type { IExtensionManager, ILogService, INotificationService } from 'asyar-api';
  import { invoke } from '@tauri-apps/api/core'; // Import invoke
  import Button from '../../components/base/Button.svelte'; // Corrected path

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
  }

  let extensionDetail: ExtensionDetail | null = null;
  let isLoading = true;
  let isInstalling = false;
  let error: string | null = null;
  let currentSlug: string | null = null; // This will hold the slug from the store
  let extensionManager: IExtensionManager | null = null; // To hold the manager from the store
  let isActive = false; // Track if this view is active for key handling
  let detailViewContainer: HTMLDivElement; // Reference to the main div

  // REMOVED Reactive statement block

  // Get services from context or store
  const logService = getContext<ILogService>('LogService'); // Keep using context for this one for now
  const notificationService = getContext<INotificationService>('NotificationService'); // Keep using context for this one for now

  // Subscribe to the store to get the selected slug AND the extension manager
  const unsubscribe = storeViewState.subscribe(state => {
    const newSlug = state.selectedExtensionSlug;
    extensionManager = state.extensionManager; // Get manager from state
    // Only update and fetch if the value actually changed to avoid potential infinite loops
    if (newSlug !== currentSlug) {
        logService?.debug(`selectedExtensionSlug changed to: ${newSlug}`);
        currentSlug = newSlug;
        // Trigger fetch directly if the new slug is valid
        if (currentSlug) {
            console.log(`[DetailView] Slug changed to ${currentSlug}, calling fetchExtensionDetails.`); // Keep this log
            fetchExtensionDetails(currentSlug); // Fetch directly on change
        } else {
            console.log(`[DetailView] Slug changed to null.`); // Log null case
            // Handle case where slug becomes null (e.g., navigating back)
            extensionDetail = null; // Clear details
            error = "No extension selected.";
            isLoading = false; // Ensure loading stops if we navigate back before fetch completes
        }
    }
    // Handle the initial null state explicitly if needed (though fetch won't run if slug is null)
    else if (!currentSlug && isLoading) { // If slug is initially null, stop loading
      error = "No extension selected.";
      isLoading = false;
    }
  });

  // --- Keyboard Handling ---
  function handleKeydown(event: KeyboardEvent) {
    if (!isActive || event.key !== 'Enter') return;

    event.preventDefault();
    event.stopPropagation();
    logService?.debug('[DetailView] Enter key pressed, attempting install.');
    installExtension(); // Call the install function
  }

  onMount(() => {
    isActive = true;
    window.addEventListener('keydown', handleKeydown);
    logService?.debug('[DetailView] Mounted, added keydown listener.');
    // Attempt to focus the container for potential scroll or focus management
    detailViewContainer?.focus();
  });

  onDestroy(() => {
    isActive = false;
    window.removeEventListener('keydown', handleKeydown);
    unsubscribe(); // Clean up the store subscription
    logService?.debug('[DetailView] Destroyed, removed keydown listener and unsubscribed.');
  });
  // --- End Keyboard Handling ---


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
      extensionDetail = data.data; // Assuming details are in 'data'
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
        version: installInfo.version
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

<!-- Added tabindex and bind:this -->
<div class="extension-detail-view p-4 overflow-y-auto h-full focus:outline-none" tabindex="-1" bind:this={detailViewContainer}>
  <Button on:click={goBack} class="mb-4">← Back to Store</Button>

  {#if isLoading}
    <p>Loading details...</p>
  {:else if error}
    <p class="text-red-500">{error}</p>
  {:else if extensionDetail}
    <div class="flex flex-col md:flex-row gap-6">
      <!-- Left Column: Icon, Name, Author, Install Button -->
      <div class="flex-shrink-0 w-full md:w-1/4 flex flex-col items-center md:items-start">
        {#if extensionDetail.icon_url}
          <img src={extensionDetail.icon_url} alt="{extensionDetail.name} icon" class="w-24 h-24 object-contain rounded mb-4">
        {:else}
          <div class="w-24 h-24 bg-gray-200 rounded flex items-center justify-center text-gray-500 mb-4 text-4xl">
            Ext
          </div>
        {/if}
        <h2 class="text-2xl font-bold mb-1 text-center md:text-left">{extensionDetail.name}</h2>
        <p class="text-md text-gray-600 mb-1 text-center md:text-left">By {extensionDetail.author.name}</p>
        <p class="text-sm text-gray-500 mb-1 text-center md:text-left">Category: {extensionDetail.category}</p>
        <p class="text-sm text-gray-500 mb-4 text-center md:text-left">Installs: {extensionDetail.install_count}</p>

        <Button on:click={installExtension} disabled={isInstalling} class="w-full mb-2">
          {isInstalling ? 'Installing...' : 'Install Latest'}
        </Button>
        {#if extensionDetail.repository_url}
          <a href={extensionDetail.repository_url} target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline text-sm mb-4 block text-center md:text-left">
            Repository →
          </a>
        {/if}
        <!-- TODO: Add Uninstall button if already installed -->
      </div>

      <!-- Right Column: Description, Versions, Screenshots -->
      <div class="flex-grow">
        <h3 class="text-lg font-semibold mb-2">Description</h3>
        <p class="text-gray-700 mb-6">{extensionDetail.description}</p>

        {#if extensionDetail.versions && extensionDetail.versions.length > 0}
          <h3 class="text-lg font-semibold mb-2">Versions</h3>
          <div class="mb-6 border border-[var(--border-color)] rounded p-3 text-sm">
            {#each extensionDetail.versions as version (version.id)}
              <div class="mb-2 pb-2 border-b border-[var(--border-color)] last:border-b-0 last:mb-0 last:pb-0">
                <p><strong>Version:</strong> {version.version_string} ({version.status})</p>
                {#if version.notes}<p class="text-gray-600 mt-1">Notes: {version.notes}</p>{/if}
                <p class="text-xs text-gray-500 mt-1">Submitted: {new Date(version.submitted_at).toLocaleDateString()}</p>
              </div>
            {/each}
          </div>
        {/if}

        {#if extensionDetail.screenshot_urls && extensionDetail.screenshot_urls.length > 0}
          <h3 class="text-lg font-semibold mb-2">Screenshots</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {#each extensionDetail.screenshot_urls as screenshotUrl (screenshotUrl)}
              <img src={screenshotUrl} alt="Screenshot" class="w-full h-auto object-contain rounded border border-gray-300">
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <p>Extension details not found.</p>
  {/if}
</div>

<style>
  /* Add specific styles if needed */
</style>
