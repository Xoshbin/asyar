<script lang="ts">
  import { mcpService } from './mcpService.svelte';

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

  // Load on mount
  load();
</script>

<div class="permissions-view">
  <div class="view-header">
    <h2 class="view-title">MCP Permissions</h2>
    <p class="view-subtitle">
      Saved permission decisions for MCP tool calls. Revoke a decision to
      re-prompt on the next call.
    </p>
  </div>

  {#if loading}
    <p class="loading-text">Loading…</p>
  {:else if mcpService.permissions.length === 0}
    <div class="empty-state">
      <p class="empty-text">No saved permissions.</p>
      <p class="empty-hint">
        Permission decisions appear here after you allow or deny an MCP tool
        call from an agent.
      </p>
    </div>
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
              <span class="decision-badge decision-{row.decision}">
                {row.decision.replace('_', ' ')}
              </span>
            </td>
            <td>
              <button
                class="btn-revoke"
                onclick={() => handleRevoke(row.serverId, row.toolId, row.agentId)}
              >
                Revoke
              </button>
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
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px);
    height: 100%;
    overflow-y: auto;
  }

  .view-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }

  .view-title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
  }

  .view-subtitle {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .loading-text {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    padding: var(--space-4, 24px) 0;
    text-align: center;
  }

  .empty-text {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .empty-hint {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .permissions-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-xs);
  }

  .permissions-table th {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color);
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .permissions-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle, var(--border-color));
    vertical-align: middle;
  }

  .cell-mono {
    font-family: var(--font-mono, monospace);
  }

  .cell-secondary {
    color: var(--text-secondary);
  }

  .decision-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    font-size: var(--font-size-xs);
    font-weight: 500;
    text-transform: lowercase;
  }

  .decision-allow_always {
    background: var(--color-success-bg, #e6f4ea);
    color: var(--color-success, #1a7340);
  }

  .decision-allow_once {
    background: var(--color-info-bg, #e8f0fe);
    color: var(--color-info, #1a5cb8);
  }

  .decision-never {
    background: var(--color-danger-bg, #fce8e8);
    color: var(--color-danger, #c5221f);
  }

  .btn-revoke {
    font-size: var(--font-size-xs);
    padding: 3px 8px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--border-color);
    background: transparent;
    cursor: pointer;
    color: var(--text-secondary);
  }

  .btn-revoke:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
