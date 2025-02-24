<script lang="ts">
  import { onMount } from 'svelte';
  import ApplicationsService from '../services/applicationsService';
  import extensionManager, { activeView } from '../services/extensionManager';
  import type { AppResult } from '../types';
  import type { ExtensionResult } from '../types/extension';
  import { LogService } from '../services/logService';

  let searchQuery = '';
  let filteredApplications: AppResult[] = [];
  let extensionResults: ExtensionResult[] = [];
  let selectedIndex = 0;
  let listContainer: HTMLDivElement;
  let loadedComponent: any = null; // renamed from viewComponent

  // Watch for activeView changes
  $: if ($activeView) {
    loadView($activeView);
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

  async function handleSearch() {
    LogService.debug(`Searching with query: "${searchQuery}"`);
    
    try {
      const [apps, extensions] = await Promise.all([
        ApplicationsService.search(searchQuery),
        extensionManager.searchAll(searchQuery)
      ]);
      
      filteredApplications = apps;
      extensionResults = extensions;
      selectedIndex = 0;
      
      LogService.debug(`Found ${extensions.length} extension results and ${apps.length} applications`);
    } catch (error) {
      LogService.error(`Search failed: ${error}`);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const totalItems = extensionResults.length + filteredApplications.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % totalItems;
      ensureSelectedInView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = selectedIndex - 1 < 0 
        ? totalItems - 1 
        : selectedIndex - 1;
      ensureSelectedInView();
    } else if (event.key === 'Enter' && totalItems > 0) {
      if (selectedIndex < extensionResults.length) {
        const selectedExtension = extensionResults[selectedIndex];
        selectedExtension.action();
      } else {
        const selectedApp = filteredApplications[selectedIndex - extensionResults.length];
        ApplicationsService.open(selectedApp);
      }
    }
  }

  function ensureSelectedInView() {
    const selectedElement = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
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
      await handleSearch();
    } catch (error) {
      LogService.error(`Failed to initialize: ${error}`);
    }
  });
</script>

{#if $activeView && loadedComponent}
  <svelte:component this={loadedComponent} />
{:else}
  <div class="fixed inset-x-0 top-0 z-50">
    <div class="w-full relative border-b-[0.5px] border-gray-400/20">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        autofocus
        placeholder="Search or type a command..."
        class="w-full text-white text-lg outline-none placeholder-gray-400 px-8 py-5"
        bind:value={searchQuery}
        on:input={handleSearch}
        on:keydown={handleKeydown}
      />
      <div class="absolute right-6 top-1/2 -translate-y-1/2">
        <kbd class="px-2.5 py-1.5 text-xs text-gray-400 rounded">⌘K</kbd>
      </div>
    </div>
  </div>

  <div class="pt-[72px] min-h-screen">
    <div class="w-full overflow-hidden">
      <div class="max-h-[calc(100vh-72px)] overflow-y-auto" bind:this={listContainer}>
        {#if extensionResults.length > 0}
          <div class="category-section">
            {#each extensionResults as result, i}
              <button
                type="button"
                data-index={i}
                class="w-full text-left px-8 py-4 flex flex-col gap-1.5 cursor-pointer transition-colors border-b-[0.5px] border-gray-700/20 last:border-0 hover:bg-gray-700/10 {i === selectedIndex ? 'bg-gray-700/20' : ''}"
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
          {#each filteredApplications as app, i}
            <button
              type="button"
              data-index={i + extensionResults.length}
              class="w-full text-left px-8 py-4 flex flex-col gap-1.5 cursor-pointer transition-colors border-b-[0.5px] border-gray-700/20 last:border-0 hover:bg-gray-700/10 {i + extensionResults.length === selectedIndex ? 'bg-gray-700/20' : ''}"
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