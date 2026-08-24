<script lang="ts">
  import { EmptyState, ListItem } from '../../../components';
  import { createdExtensionsViewState } from './createdExtensionsViewState.svelte';
  import { t } from '../../../services/i18n';

  const items = $derived(createdExtensionsViewState.filtered());
  const selectedIndex = $derived(createdExtensionsViewState.selectedIndex);
</script>

<div class="view-container">
  <div class="form-body custom-scrollbar">
    {#if items.length === 0}
      <EmptyState
        message={t('features.create_extension.no_extensions')}
        description={t('features.create_extension.no_extensions_description')}
      />
    {:else}
      {#each items as ext, i (ext.path)}
        <ListItem title={ext.name} subtitle={ext.description} selected={i === selectedIndex}>
          {#snippet trailing()}
            <span class="text-caption">v{ext.version}</span>
            <span class="text-caption">{ext.id}</span>
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>
</div>

<style>
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-3);
  }
</style>
