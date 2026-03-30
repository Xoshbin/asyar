<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { storeViewState as store } from './state.svelte';
  import SplitView from '../../components/list/SplitView.svelte';

  let isLoading = $derived(store.isLoading);
  let error = $derived(store.loadError ? store.errorMessage : null);
  let filteredItems = $derived(store.filteredItems);
  let selectedIndex = $derived(store.selectedIndex);
  let selectedItem = $derived(store.selectedItem);
  let extensionManager = $derived(store.extensionManager);

  let listContainer: HTMLDivElement | undefined = $state();

  onMount(async () => {
    await tick();
  });

  function ensureSelectedVisible() {
    requestAnimationFrame(() => {
      if (!listContainer) return;
      const element = listContainer.querySelector(`[data-index="${selectedIndex}"]`);
      if (element) {
        const containerRect = listContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const isAbove = elementRect.top < containerRect.top;
        const isBelow = elementRect.bottom > containerRect.bottom;

        if (isAbove) {
          element.scrollIntoView({ block: 'start', behavior: 'auto' });
        } else if (isBelow) {
          element.scrollIntoView({ block: 'end', behavior: 'auto' });
        }
      }
    });
  }

  function selectItem(index: number) {
    store.setSelectedItemByIndex(index);
  }

  $effect(() => {
    if (selectedIndex !== undefined && !isLoading && !error) {
      ensureSelectedVisible();
    }
  });

  function handleDoubleClick(slug: string) {
    store.setSelectedExtensionSlug(slug);
    if (extensionManager) {
      extensionManager.navigateToView(`store/DetailView`);
    }
  }
</script>

<SplitView leftWidth={320} minLeftWidth={250} maxLeftWidth={500}>
  {#snippet left()}
    <div 
      bind:this={listContainer}
      class="store-left-panel custom-scrollbar"
      role="listbox"
      aria-label="Store Extensions"
      tabindex="0"
    >
      {#if isLoading}
        <div class="flex items-center justify-center p-8">
          <div class="text-label">Loading extensions...</div>
        </div>
      {:else if error}
        <div class="empty-state" style="color: var(--accent-danger);">
          {error}
        </div>
      {:else if filteredItems.length === 0}
        <div class="empty-state">No extensions found</div>
      {:else}
        {#each filteredItems as item, index (item.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div
            data-index={index}
            class="list-row {selectedIndex === index ? 'selected' : ''}"
            role="option"
            aria-selected={selectedIndex === index}
            onclick={() => selectItem(index)}
            ondblclick={() => handleDoubleClick(item.slug)}
          >
            <div class="store-icon-box">
              {#if item.icon_url}
                <img src={item.icon_url} alt={item.name} class="w-full h-full object-cover" />
              {:else}
                <span class="text-lg">🧩</span>
              {/if}
            </div>
            <div class="flex-1 overflow-hidden flex flex-col justify-center gap-0.5">
              <div class="flex items-center gap-2">
                <div class="truncate text-body">
                  {item.name}
                </div>
              </div>
              <div class="truncate text-caption">
                By {item.author.name}
              </div>
            </div>
            <div class="ml-2 flex-shrink-0 text-right space-y-1">
              <div class="text-mono type-badge" style={selectedIndex === index ? 'color: var(--text-primary)' : ''}>
                {item.category}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    <div class="store-right-panel">
      {#if selectedItem}
        <div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar flex flex-col items-center pt-12">
          <div class="store-hero-icon">
            {#if selectedItem.icon_url}
              <img src={selectedItem.icon_url} alt={selectedItem.name} class="w-full h-full object-cover" />
            {:else}
              <span class="text-6xl">🧩</span>
            {/if}
          </div>
          
          <h2 class="store-detail-title">{selectedItem.name}</h2>
          
          <div class="flex items-center gap-3 text-caption mb-6">
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              {selectedItem.author.name}
            </span>
            <span class="dot">·</span>
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              {selectedItem.install_count} Installs
            </span>
          </div>

          <p class="text-body text-center max-w-md">
            {selectedItem.description}
          </p>

          {#if selectedItem.screenshot_urls && selectedItem.screenshot_urls.length > 0}
            <div class="store-screenshot">
              <img src={selectedItem.screenshot_urls[0]} alt="Screenshot" class="store-screenshot-img" />
            </div>
          {/if}
        </div>

        <!-- Action Footer -->
        <div class="store-footer">
          <div class="flex items-center gap-3">
                <span class="text-mono status-badge">
                  {selectedItem.status}
                </span>
              <span>Added {new Date(selectedItem.created_at).toLocaleDateString()}</span>
          </div>
          <div class="flex items-center gap-1.5 text-caption">
            <kbd>Enter</kbd> 
            <span>to View Details</span>
          </div>
        </div>
      {:else}
        <div class="empty-state">
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span class="text-caption">Select an extension to view details</span>
        </div>
      {/if}
    </div>
  {/snippet}
</SplitView>

<style>
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-xs);
  }

  .store-left-panel {
    height: 100%;
    overflow-y: auto;
  }
  .store-left-panel:focus { outline: none; }

  .store-icon-box {
    margin-right: 12px;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
  }

  .store-right-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .store-hero-icon {
    width: 128px;
    height: 128px;
    border-radius: 24px;
    background: var(--bg-primary);
    box-shadow: 0 1px 2px var(--shadow-color);
    border: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
    overflow: hidden;
  }

  .store-detail-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 8px;
    text-align: center;
  }

  .store-screenshot {
    margin-top: 32px;
    width: 100%;
    max-width: 28rem;
    background: var(--bg-secondary);
    padding: 8px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    box-shadow: 0 1px 2px var(--shadow-color);
  }

  .store-footer {
    height: 48px;
    border-top: 1px solid var(--separator);
    background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    padding: 0 16px;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-tertiary);
    z-index: 10;
    width: 100%;
    flex-shrink: 0;
  }

  .type-badge {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius-xs);
  }

  .status-badge {
    background: color-mix(in srgb, var(--accent-success) 12%, transparent);
    color: var(--accent-success);
    padding: 2px 6px;
    border-radius: var(--radius-xs);
  }

  .store-screenshot-img {
    width: 100%;
    border-radius: var(--radius-sm);
    border: 1px solid var(--separator);
    object-fit: cover;
  }

  .dot { font-size: 10px; opacity: 0.5; }
</style>
