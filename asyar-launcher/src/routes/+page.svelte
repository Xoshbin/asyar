<script lang="ts">
  import { onMount } from 'svelte';
  import { searchQuery, searchResults } from '../stores/search';
  import ApplicationsService from '../services/applicationsService';
  import extensionManager, { activeView } from '../services/extensionManager';
  import { LogService } from '../services/logService';
  import { ResultsList } from '../components';
  import { fuzzySearch } from '../utils/fuzzySearch';

  let listContainer: HTMLDivElement;
  let loadedComponent: any = null;
  
  // Cache for all applications and extensions
  let allApplications: any[] = [];
  let allExtensions: any[] = [];
  let isInitialized = false;

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
      // For complete initialization or empty queries, ensure we have cached data
      if (!isInitialized || !query || query.trim() === "") {
        if (allApplications.length === 0) {
          allApplications = await ApplicationsService.getAllApplications();
        }
        
        if (allExtensions.length === 0) {
          allExtensions = await extensionManager.getAllExtensions();
        }
        isInitialized = true;
      }

      let extensions = [];
      let apps = [];

      // For short queries, use the cached data with fuzzy search
      if (!query || query.trim().length < 2) {
        extensions = allExtensions;
        apps = allApplications;
      } else {
        // For specific queries, use direct search from services
        [apps, extensions] = await Promise.all([
          ApplicationsService.search(query),
          extensionManager.searchAll(query)
        ]);
        
        // If direct search doesn't return enough results, supplement with fuzzy search
        if (extensions.length === 0) {
          extensions = fuzzySearch(allExtensions, query, {
            keys: ['title', 'subtitle', 'keywords'],
            threshold: 0.4
          });
        }
      }
      
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
      // Cache all applications and extensions for fuzzy search
      allApplications = await ApplicationsService.getAllApplications();
      await extensionManager.loadExtensions();
      allExtensions = await extensionManager.getAllExtensions();
      isInitialized = true;
      
      LogService.info("Cache and extensions loaded successfully");
      await handleSearch($searchQuery);
    } catch (error) {
      LogService.error(`Failed to initialize: ${error}`);
    }
  });

  // Transform items for ResultsList
  $: extensionItems = $searchResults.extensions.map(result => ({
    title: result.title,
    subtitle: result.subtitle || (result.score !== undefined ? `Match score: ${Math.round((1 - result.score) * 100)}%` : ''),
    action: result.action
  }));

  $: applicationItems = $searchResults.applications.map(app => ({
    title: app.name,
    subtitle: app.path || (app.score !== undefined ? `Match score: ${Math.round((1 - app.score) * 100)}%` : ''),
    action: () => ApplicationsService.open(app)
  }));
</script>

{#if $activeView && loadedComponent}
  <div class="h-[calc(100vh-72px)]">
    <svelte:component this={loadedComponent} />
  </div>
{:else}
  <div class="min-h-[calc(100vh-72px)]">
    <div class="w-full overflow-hidden">
      <div bind:this={listContainer}>
        {#if extensionItems.length > 0}
          <ResultsList
            items={extensionItems}
            selectedIndex={$searchResults.selectedIndex}
            on:select={({ detail }) => {
              if (detail.item && detail.item.action) {
                detail.item.action();
              }
            }}
          />
        {/if}

        <ResultsList
          items={applicationItems}
          selectedIndex={$searchResults.selectedIndex - extensionItems.length}
          on:select={({ detail }) => {
            if (detail.item && detail.item.action) {
              detail.item.action();
            }
          }}
        />
      </div>
    </div>
  </div>
{/if}