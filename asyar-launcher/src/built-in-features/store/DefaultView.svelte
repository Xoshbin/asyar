<script lang="ts">
  import { storeViewState as store, getInstallCount } from './state.svelte';
  import {
    SplitListDetail,
    EmptyState,
    ListItem,
    ExtensionAvatar,
    Badge,
    SegmentedControl,
    ActionFooter,
    KeyboardHint,
  } from '../../components';
  import { nameToGradient } from '../../lib/extensionAvatar';
  import { t } from '../../services/i18n';

  let isLoading = $derived(
    store.currentSource === 'raycast' ? store.isRaycastLoading : store.isLoading,
  );
  let error = $derived(store.loadError ? store.errorMessage : null);
  let filteredItems = $derived(store.filteredItems);
  let selectedIndex = $derived(store.selectedIndex);
  let selectedItem = $derived(store.selectedItem);
  let extensionManager = $derived(store.extensionManager);
  let selectedGradient = $derived(
    selectedItem ? nameToGradient(selectedItem.name) : { from: 'transparent', to: 'transparent' },
  );

  function selectItem(index: number) {
    store.setSelectedItemByIndex(index);
  }

  function handleDoubleClick(item: any) {
    store.setSelectedExtension(item);
    if (extensionManager) {
      extensionManager.navigateToView(`store/DetailView`);
    }
  }
</script>

<SplitListDetail
  items={filteredItems}
  {selectedIndex}
  {isLoading}
  loadingMessage={t('features.store.loading_extensions')}
  {error}
  leftWidth={320}
  minLeftWidth={250}
  maxLeftWidth={500}
  ariaLabel="Store Extensions"
  emptyMessage={t('features.store.no_extensions_found')}
>
  {#snippet leftHeader()}
    <div class="source-toggle">
      <SegmentedControl
        options={[
          { value: 'all', label: 'All' },
          { value: 'asyar', label: 'Asyar' },
          { value: 'raycast', label: 'Raycast' },
        ]}
        value={store.currentSource}
        onchange={(val) => store.setSource(val as 'all' | 'asyar' | 'raycast')}
      />
    </div>
  {/snippet}

  {#snippet listItem(item, index)}
    <ListItem
      data-index={index}
      selected={selectedIndex === index}
      onclick={() => selectItem(index)}
      ondblclick={() => handleDoubleClick(item)}
      title={item.name}
      subtitle={`By ${item.author.name}`}
    >
      {#snippet leading()}
        {#if item.iconUrl}
          <div class="store-item-avatar">
            <img src={item.iconUrl} alt={item.name} class="store-item-icon" />
          </div>
        {:else}
          <ExtensionAvatar name={item.name} size="sm" />
        {/if}
      {/snippet}
      {#snippet trailing()}
        {#if item.status === 'UPDATE_AVAILABLE'}
          <Badge text="Update" variant="warning" mono />
        {:else if item.status === 'INSTALLED'}
          <Badge text="Installed" variant="success" mono />
        {:else if item.source === 'raycast'}
          <Badge text="Raycast" variant="default" mono />
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

      <div
        class="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar flex flex-col items-center pt-12"
      >
        {#if selectedItem.iconUrl}
          <div class="store-detail-avatar">
            <img src={selectedItem.iconUrl} alt={selectedItem.name} class="store-detail-icon" />
          </div>
        {:else}
          <ExtensionAvatar name={selectedItem.name} size="xl" />
        {/if}

        <h2 class="store-detail-title">{selectedItem.name}</h2>

        <div class="flex items-center gap-3 text-caption mb-6">
          <span class="flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              /></svg
            >
            {selectedItem.author.name}
          </span>
          <span class="dot">·</span>
          <span class="flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              /></svg
            >
            {getInstallCount(selectedItem).toLocaleString()} Installs
          </span>
        </div>

        <p class="text-body text-center max-w-md">
          {selectedItem.description}
        </p>

        {#if selectedItem.manifest?.commands && selectedItem.manifest.commands.length > 0}
          <div class="raycast-commands-box">
            <div class="raycast-commands-title">
              Commands ({selectedItem.manifest.commands.length})
            </div>
            <div class="raycast-commands-list">
              {#each selectedItem.manifest.commands.slice(0, 5) as cmd}
                <div class="raycast-command-row">
                  <span class="font-medium text-body">{cmd.name}</span>
                  <Badge text={cmd.mode || 'view'} variant="default" mono />
                </div>
              {/each}
              {#if selectedItem.manifest.commands.length > 5}
                <div
                  class="text-caption"
                  style="color: var(--text-tertiary); margin-top: var(--space-1);"
                >
                  +{selectedItem.manifest.commands.length - 5} more commands
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if selectedItem.screenshot_urls && selectedItem.screenshot_urls.length > 0}
          <div class="store-screenshot">
            <img
              src={selectedItem.screenshot_urls[0]}
              alt="Screenshot"
              class="store-screenshot-img"
            />
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
            {:else if selectedItem.source === 'raycast'}
              <Badge text="Raycast Extension" variant="default" mono />
            {:else}
              <Badge text={selectedItem.category} variant="default" mono />
            {/if}
            <span class="text-caption">
              {selectedItem.created_at || (selectedItem as any).createdAt
                ? `Added ${new Date(selectedItem.created_at ?? (selectedItem as any).createdAt).toLocaleDateString()}`
                : selectedItem.source === 'raycast'
                  ? 'Raycast Store'
                  : ''}
            </span>
          </div>
        {/snippet}
        {#snippet right()}
          <KeyboardHint keys="Enter" action="to View Details" />
        {/snippet}
      </ActionFooter>
    {:else}
      <EmptyState message={t('features.store.select_extension')}>
        {#snippet icon()}
          <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        {/snippet}
      </EmptyState>
    {/if}
  {/snippet}
</SplitListDetail>

<style>
  .source-toggle {
    margin-bottom: var(--space-1);
  }

  .store-item-avatar {
    width: var(--size-lg);
    height: var(--size-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    overflow: hidden;
    flex-shrink: 0;
  }

  .store-item-icon {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .store-detail-avatar {
    width: var(--size-3xl);
    height: var(--size-3xl);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    padding: var(--space-2);
    box-shadow: var(--shadow-sm);
  }

  .store-detail-icon {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .detail-accent-strip {
    height: 3px;
    width: 100%;
    flex-shrink: 0;
  }

  .store-detail-title {
    font-size: var(--font-size-xl);
    font-weight: 700;
    color: var(--text-primary);
    margin: var(--space-8) 0 var(--space-3);
    text-align: center;
  }

  .raycast-commands-box {
    margin-top: var(--space-6);
    width: 100%;
    max-width: 24rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }

  .raycast-commands-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--text-secondary);
    margin-bottom: var(--space-2);
  }

  .raycast-commands-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .raycast-command-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--font-size-sm);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .raycast-command-row:last-child {
    border-bottom: none;
  }

  .store-screenshot {
    margin-top: var(--space-9);
    width: 100%;
    max-width: 28rem;
    background: var(--bg-secondary);
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-xs);
  }

  .store-screenshot-img {
    width: 100%;
    border-radius: var(--radius-sm);
    border: 1px solid var(--separator);
    object-fit: cover;
  }

  .dot {
    font-size: var(--font-size-2xs);
    opacity: 0.5;
  }
</style>
