<script lang="ts">
  import { storeViewState as store } from './state.svelte';
  import {
    SplitListDetail,
    EmptyState,
    ListItem,
    ExtensionAvatar,
    Badge,
    ActionFooter,
    KeyboardHint
  } from '../../components';
  import { nameToGradient } from '../../lib/extensionAvatar';

  let isLoading = $derived(store.isLoading);
  let error = $derived(store.loadError ? store.errorMessage : null);
  let filteredItems = $derived(store.filteredItems);
  let selectedIndex = $derived(store.selectedIndex);
  let selectedItem = $derived(store.selectedItem);
  let extensionManager = $derived(store.extensionManager);
  let selectedGradient = $derived(
    selectedItem ? nameToGradient(selectedItem.name) : { from: 'transparent', to: 'transparent' }
  );

  function selectItem(index: number) {
    store.setSelectedItemByIndex(index);
  }

  function handleDoubleClick(slug: string) {
    store.setSelectedExtensionSlug(slug);
    if (extensionManager) {
      extensionManager.navigateToView(`store/DetailView`);
    }
  }
</script>

<SplitListDetail
  items={filteredItems}
  {selectedIndex}
  {isLoading}
  loadingMessage="Loading extensions..."
  {error}
  leftWidth={320}
  minLeftWidth={250}
  maxLeftWidth={500}
  ariaLabel="Store Extensions"
  emptyMessage="No extensions found"
>
  {#snippet listItem(item, index)}
    <ListItem
      data-index={index}
      selected={selectedIndex === index}
      onclick={() => selectItem(index)}
      ondblclick={() => handleDoubleClick(item.slug)}
      title={item.name}
      subtitle={`By ${item.author.name}`}
    >
      {#snippet leading()}
        <ExtensionAvatar name={item.name} size="sm" />
      {/snippet}
      {#snippet trailing()}
        {#if item.status === 'UPDATE_AVAILABLE'}
          <Badge text="Update" variant="warning" mono />
        {:else if item.status === 'INSTALLED'}
          <Badge text="Installed" variant="success" mono />
        {:else}
          <Badge text={item.category} variant="default" mono />
        {/if}
      {/snippet}
    </ListItem>
  {/snippet}

  {#snippet detail()}
    {#if selectedItem}
      <div
        class="detail-accent-strip"
        style="background: linear-gradient(90deg, {selectedGradient.from}, {selectedGradient.to});"
      ></div>

      <div class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar flex flex-col items-center pt-12">
        <ExtensionAvatar name={selectedItem.name} size="xl" />

        <h2 class="store-detail-title">{selectedItem.name}</h2>

        <div class="flex items-center gap-3 text-caption mb-6">
          <span class="flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
            {selectedItem.author.name}
          </span>
          <span class="dot">·</span>
          <span class="flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            {(selectedItem.install_count ?? 0).toLocaleString()} Installs
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

      <ActionFooter>
        {#snippet left()}
          <div class="flex items-center gap-3">
            {#if selectedItem.status === 'UPDATE_AVAILABLE'}
              <Badge text="Update Available" variant="warning" mono />
            {:else if selectedItem.status === 'INSTALLED'}
              <Badge text="Installed" variant="success" mono />
            {:else}
              <Badge text={selectedItem.category} variant="default" mono />
            {/if}
            <span class="text-caption">Added {new Date(selectedItem.created_at ?? (selectedItem as any).createdAt).toLocaleDateString()}</span>
          </div>
        {/snippet}
        {#snippet right()}
          <KeyboardHint keys="Enter" action="to View Details" />
        {/snippet}
      </ActionFooter>
    {:else}
      <EmptyState message="Select an extension to view details">
        {#snippet icon()}
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        {/snippet}
      </EmptyState>
    {/if}
  {/snippet}
</SplitListDetail>

<style>
  .detail-accent-strip {
    height: 3px;
    width: 100%;
    flex-shrink: 0;
  }

  .store-detail-title {
    font-size: var(--font-size-xl);
    font-weight: 700;
    color: var(--text-primary);
    margin: 24px 0 8px;
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

  .store-screenshot-img {
    width: 100%;
    border-radius: var(--radius-sm);
    border: 1px solid var(--separator);
    object-fit: cover;
  }

  .dot { font-size: var(--font-size-2xs); opacity: 0.5; }
</style>
