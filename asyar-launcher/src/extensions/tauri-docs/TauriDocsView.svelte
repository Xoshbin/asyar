<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { tauriDocsState } from "./state";
  import { ExtensionApi } from "../../api/extensionApi";
  import { openUrl } from "@tauri-apps/plugin-opener"; // Use open directly instead of openUrl
  
  let selectedIndex = 0;
  let resultsContainer: HTMLElement;
  
  $: results = $tauriDocsState.searchResults.map((doc, index) => ({
    title: doc.title,
    subtitle: doc.description,
    category: doc.category,
    url: doc.url, // Store the URL directly in the result object
    action: () => openDocUrl(doc.url)
  }));
  
  // Get unique categories from results for filtering
  $: availableCategories = [...new Set(results.map(r => r.category))].sort();
  
  // Function to get category display name with first letter capitalized
  function getCategoryDisplayName(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }
  
  onMount(() => {
    // Focus the results container initially
    if (resultsContainer) {
      resultsContainer.focus();
    }
    
    // Add global keydown event listener with true for capture phase to ensure we get it first
    window.addEventListener('keydown', handleGlobalKeydown, true);
  });
  
  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown, true);
  });
  
  // Simplified global keydown handler focused on just making Enter work
  function handleGlobalKeydown(event: KeyboardEvent) {
    if (!results.length) return;
    
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Prevent default actions like scrolling
      event.preventDefault();
      event.stopPropagation();
      
      const newIndex = event.key === 'ArrowUp'
        ? Math.max(0, selectedIndex - 1)
        : Math.min(results.length - 1, selectedIndex + 1);
      
      if (newIndex !== selectedIndex) {
        selectedIndex = newIndex;
        // Always scroll when selection changes
        requestAnimationFrame(() => scrollToSelected(true));
      }
    } 
    else if (event.key === 'Enter') {
      // Simplified Enter handling - no extra checks that might interfere
      event.preventDefault();
      event.stopPropagation();
      
      console.log("Enter pressed, index:", selectedIndex);
      
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        const selectedResult = results[selectedIndex];
        
        // Call the action directly without setTimeout
        console.log("Opening URL for:", selectedResult.title);
        selectedResult.action();
      }
    }
  }
  
  // Simplified direct URL opening function
  async function openDocUrl(url: string) {
    try {
      console.log("Opening URL:", url);
      
      // Try to hide window FIRST
      try {
        await ExtensionApi.window.hide();
      } catch (hideError) {
        console.error("Failed to hide window:", hideError);
      }
      
      // Use direct open from tauri plugin (not openUrl wrapper)
      await openUrl(url);
      
    } catch (error) {
      console.error("Error opening URL with opener plugin:", error);
      
      // Fallback using ExtensionApi
      try {
        await ExtensionApi.apps.open(url);
      } catch (fallbackError) {
        console.error("Fallback opening method also failed:", fallbackError);
      }
    }
  }
  
  // Remove or simplify the local handler since we have a better global one now
  function handleKeydown(event: KeyboardEvent) {
    // We'll leave this empty or minimal since we're using the global handler
    // This is just to maintain the focus on the element
  }
  
  function scrollToSelected(forceScroll = false) {
    const element = resultsContainer?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
    if (!element) return;
    
    const container = resultsContainer;
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    const isElementAbove = elementRect.top < containerRect.top;
    const isElementBelow = elementRect.bottom > containerRect.bottom;
    const needsScroll = forceScroll || isElementAbove || isElementBelow;
    
    if (needsScroll) {
      element.scrollIntoView({
        block: forceScroll ? 'center' : (isElementAbove ? 'start' : 'end'),
        behavior: 'smooth'
      });
    }
  }
</script>

<!-- Change the wrapper to ensure proper containment -->
<div class="h-[calc(100vh-72px)] overflow-hidden">
  <div class="p-6 max-w-4xl mx-auto h-full flex flex-col">
    <div class="mb-4 flex-shrink-0">
      <h1 class="text-xl font-medium text-[var(--text-primary)]">Tauri v2 Documentation</h1>
      <p class="text-sm text-[var(--text-secondary)] mt-1">
        Browse and search through the official Tauri v2 documentation
      </p>
    </div>
    
    <!-- This container now properly contains the scrollable area -->
    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      <div 
        bind:this={resultsContainer}
        class="flex-1 overflow-y-auto custom-scrollbar min-h-0 relative"
        tabindex="0"
        on:keydown={handleKeydown}
      >
        {#if results.length > 0}
          <div class="divide-y divide-[var(--border-color)]">
            {#each results as result, index (index)}
              <!-- Fix the data attribute to check for URL instead of action function -->
              <div
                data-index={index}
                data-url={result.url || "no-url"}
                class="result-item w-full text-left px-4 py-3 flex flex-col cursor-pointer 
                       transition-all duration-150 ease-in-out hover:bg-[var(--bg-hover)]
                       {selectedIndex === index ? 'selected-result' : ''}"
                on:click={() => {
                  selectedIndex = index;
                  // Log the click to confirm it's working
                  console.log("Clicked item:", result.title);
                  // Direct synchronous call of the action
                  result.action();
                }}
              >
                <div class="flex justify-between items-start gap-3">
                  <div class="flex-grow">
                    <div class="result-title font-medium">{result.title}</div>
                    <div class="result-subtitle text-sm mt-0.5">{result.subtitle}</div>
                  </div>
                  
                  <div class="flex-shrink-0 mt-0.5">
                    <span class="badge badge-secondary text-xs">
                      {getCategoryDisplayName(result.category)}
                    </span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
          
          <div class="h-8"></div> <!-- Bottom spacing -->
        {:else}
          <div class="text-center py-6 text-[var(--text-secondary)] bg-[var(--bg-hover)] rounded-lg">
            No documentation found. Try a different search term.
          </div>
        {/if}
      </div>
      
      <!-- Tip section remains at the bottom -->
      <div class="flex-shrink-0 text-sm text-[var(--text-secondary)] mt-4 mb-2 bg-[var(--bg-hover)] p-3 rounded-lg">
        <p>💡 <strong>Tip:</strong> You can also search directly from the main search bar using "tauri [your search term]"</p>
        <p class="mt-2">⌨️ Use arrow keys <span class="keyboard-shortcut">↑</span>/<span class="keyboard-shortcut">↓</span> to navigate and <span class="keyboard-shortcut">Enter</span> to open in browser</p>
      </div>
    </div>
  </div>
</div>

<style>
  .selected-result {
    background-color: var(--bg-selected);
  }
  
  .result-title {
    color: var(--text-primary);
  }
  
  .result-subtitle {
    color: var(--text-secondary);
  }
  
  /* Apply keyboard shortcut styling from the main CSS */
  :global(.keyboard-shortcut) {
    padding: 0.125rem 0.375rem;
    font-size: 0.75rem;
    border-radius: 0.25rem;
    background-color: var(--bg-tertiary, rgba(100, 100, 100, 0.15));
    color: var(--text-secondary, #8A958A);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  
  /* Add styles to ensure proper containment */
  :global(.app-layout .custom-scrollbar) {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }
  
  :global(.app-layout .custom-scrollbar::-webkit-scrollbar) {
    width: 8px;
  }
  
  :global(.app-layout .custom-scrollbar::-webkit-scrollbar-track) {
    background: transparent;
  }
  
  :global(.app-layout .custom-scrollbar::-webkit-scrollbar-thumb) {
    background-color: var(--scrollbar-thumb, rgba(155, 155, 155, 0.5));
    border-radius: 20px;
  }
</style>
