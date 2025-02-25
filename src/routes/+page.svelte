<script lang="ts">
  import { onMount } from 'svelte';
  import { searchQuery, searchResults } from '../stores/search';
  import ApplicationsService from '../services/applicationsService';
  import extensionManager, { activeView } from '../services/extensionManager';
  import type { AppResult } from '../types';
  import type { ExtensionResult } from '../types/extension';
  import { LogService } from '../services/logService';

  let listContainer: HTMLDivElement;
  let loadedComponent: any = null; // renamed from viewComponent

  // Watch for activeView changes
  $: if ($activeView) {
    loadView($activeView);
  }

  // Watch for search query changes
  $: if (!$activeView) {
    handleSearch($searchQuery);
  }

  async function loadView(viewPath: string) {
    try {
      LogService.debug(`Loading view for path: ${viewPath}`);
      // Split viewPath to handle both extension and view components
      const [extensionName, componentName] = viewPath.split('/');
      
      const module = await import(`../extensions/${extensionName}/${componentName}.svelte`);
      LogService.debug(`View module loaded: ${JSON.stringify(module)}`);
      
      if (!module.default) {
        throw new Error('View component not found in module');
      }
      
      loadedComponent = module.default;
      LogService.debug(`Successfully loaded view component`);
    } catch (error) {
      LogService.error(`Failed to load view ${viewPath}: ${error}`);
      // Reset view on error
      extensionManager.closeView();
    }
  }

  async function handleSearch(query: string) {
    LogService.debug(`Searching with query: "${query}"`);
    
    try {
      const [apps, extensions] = await Promise.all([
        ApplicationsService.search(query),
        extensionManager.searchAll(query)
      ]);
      
      searchResults.set({
        extensions,
        applications: apps,
        selectedIndex: 0
      });
      
      LogService.debug(`Found ${extensions.length} extension results and ${apps.length} applications`);
    } catch (error) {
      LogService.error(`Search failed: ${error}`);
    }
  }

  $: if (listContainer && $searchResults.selectedIndex >= 0) {
    const selectedElement = listContainer.querySelector(`[data-index="${$searchResults.selectedIndex}"]`);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }

  onMount(async () => {
    await LogService.init();
    LogService.info("Application starting...");
    
    try {
      await Promise.all([
        ApplicationsService.refreshCache(),
        extensionManager.loadExtensions()
      ]);
      LogService.info("Cache and extensions loaded successfully");
      await handleSearch($searchQuery);
    } catch (error) {
      LogService.error(`Failed to initialize: ${error}`);
    }
  });
</script>

{#if $activeView && loadedComponent}
  <div class="h-[calc(100vh-72px)]">
    <svelte:component this={loadedComponent} />
  </div>
{:else}
  <div class="min-h-[calc(100vh-72px)]">
    <div class="w-full overflow-hidden">
      <div class="max-h-[calc(100vh-72px)] overflow-y-auto" bind:this={listContainer}>
        {#if $searchResults.extensions.length > 0}
          <div class="category-section">
            {#each $searchResults.extensions as result, i}
              <button
                type="button"
                data-index={i}
                class="w-full text-left px-8 py-4 flex flex-col gap-1.5 cursor-pointer transition-colors border-b-[0.5px] border-gray-700/20 last:border-0 hover:bg-gray-700/10 {i === $searchResults.selectedIndex ? 'bg-gray-700/20' : ''}"
                on:click={result.action}
              >
                <div class="text-white">{result.title}</div>
                {#if result.subtitle}
                  <div class="text-gray-400 text-sm">{result.subtitle}</div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        <div class="category-section">
          {#each $searchResults.applications as app, i}
            <button
              type="button"
              data-index={i + $searchResults.extensions.length}
              class="w-full text-left px-8 py-4 flex flex-col gap-1.5 cursor-pointer transition-colors border-b-[0.5px] border-gray-700/20 last:border-0 hover:bg-gray-700/10 {i + $searchResults.extensions.length === $searchResults.selectedIndex ? 'bg-gray-700/20' : ''}"
              on:click={() => ApplicationsService.open(app)}
            >
              <div class="text-white">{app.name}</div>
              <div class="text-gray-400 text-sm">{app.path}</div>
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}