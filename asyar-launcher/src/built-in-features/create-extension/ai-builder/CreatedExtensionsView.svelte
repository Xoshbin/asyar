<script lang="ts">
  import { EmptyState, ListItem } from '../../../components';
  import { createdExtensionsViewState } from './createdExtensionsViewState.svelte';

  const items = $derived(createdExtensionsViewState.filtered());
  const selectedIndex = $derived(createdExtensionsViewState.selectedIndex);
</script>

<div class="view-container">
  <div class="form-body custom-scrollbar">
    {#if items.length === 0}
      <EmptyState
        message="No extensions yet"
        description={'Build one with "Build Extension with AI".'}
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
