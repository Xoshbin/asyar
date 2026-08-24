<script lang="ts">
  import { onMount } from 'svelte';
  import { mcpService } from './mcpService.svelte';
  import ServerCard from './ServerCard.svelte';
  import EmptyState from '../../components/feedback/EmptyState.svelte';
  import Badge from '../../components/base/Badge.svelte';
  import { t } from '../../services/i18n';

  const servers = $derived(mcpService.servers);
  const detectedConfigs = $derived(mcpService.detectedConfigs);
  const loading = $derived(mcpService.loading);
  const strictMode = $derived(mcpService.strictMode);

  // Hydrate state when the view opens — covers cold launch where this view
  // is the first to query the MCP feature.
  onMount(() => {
    void mcpService.refresh();
  });
</script>

<div class="manage-view">
  {#if strictMode}
    <span class="strict-mode-badge" title="Strict mode on — every tool call asks for permission">
      <Badge text="Strict" variant="warning" />
    </span>
  {/if}

  {#if loading}
    <EmptyState message={t('features.mcp.loading_servers')} />
  {:else if servers.length === 0}
    {#if detectedConfigs.length > 0}
      <EmptyState
        message={t('features.mcp.no_servers')}
        description={t('features.mcp.detected_configs_description', {
          sources: detectedConfigs.map((c) => c.source).join(', '),
        })}
      />
    {:else}
      <EmptyState
        message={t('features.mcp.no_servers')}
        description={t('features.mcp.no_servers_install_description')}
      />
    {/if}
  {:else}
    <div class="server-list custom-scrollbar">
      {#each servers as server (server.id)}
        <ServerCard {server} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .manage-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .server-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .strict-mode-badge {
    position: absolute;
    top: var(--space-2);
    right: var(--space-3);
    z-index: var(--z-base);
  }
</style>
