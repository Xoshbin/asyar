<script lang="ts">
  import { mcpService } from './mcpService.svelte';
  import EmptyState from '../../components/feedback/EmptyState.svelte';
  import LoadingState from '../../components/feedback/LoadingState.svelte';
  import Badge from '../../components/base/Badge.svelte';
  import Button from '../../components/base/Button.svelte';

  let loading = $state(false);

  async function load(): Promise<void> {
    loading = true;
    try {
      await mcpService.refreshPermissions();
    } finally {
      loading = false;
    }
  }

  async function handleRevoke(
    serverId: string,
    toolId: string,
    agentId: string,
  ): Promise<void> {
    await mcpService.deletePermission(serverId, toolId, agentId);
  }

  function decisionVariant(decision: string): 'success' | 'info' | 'danger' | 'default' {
    if (decision === 'allow_always') return 'success';
    if (decision === 'allow_once') return 'info';
    if (decision === 'never') return 'danger';
    return 'default';
  }

  // Load on mount
  load();
</script>

<div class="permissions-view">
  {#if loading}
    <LoadingState message="Loading…" />
  {:else if mcpService.permissions.length === 0}
    <EmptyState
      message="No saved permissions"
      description="Permission decisions appear here after you allow or deny an MCP tool call from an agent."
    />
  {:else}
    <table class="permissions-table">
      <thead>
        <tr>
          <th>Server</th>
          <th>Tool</th>
          <th>Agent</th>
          <th>Decision</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each mcpService.permissions as row (row.serverId + '/' + row.toolId + '/' + row.agentId)}
          <tr class="permission-row">
            <td class="cell-mono">{row.serverId}</td>
            <td class="cell-mono">{row.toolId}</td>
            <td class="cell-secondary">{row.agentId || '—'}</td>
            <td>
              <Badge text={row.decision.replace('_', ' ')} variant={decisionVariant(row.decision)} />
            </td>
            <td>
              <Button onclick={() => handleRevoke(row.serverId, row.toolId, row.agentId)}>
                Revoke
              </Button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .permissions-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    height: 100%;
    overflow-y: auto;
  }

  .permissions-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-xs);
  }

  .permissions-table th {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-color);
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .permissions-table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--separator);
    vertical-align: middle;
  }

  .cell-mono {
    font-family: var(--font-mono);
  }

  .cell-secondary {
    color: var(--text-secondary);
  }
</style>
