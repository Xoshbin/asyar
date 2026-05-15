<script lang="ts">
  import { mcpService } from './mcpService.svelte';
  import { statusBadgeColor, transportLabel } from './manageServersView.helpers';
  import type { McpServerSummary } from './types';

  interface Props {
    server: McpServerSummary;
  }

  const { server }: Props = $props();

  let uninstalling = $state(false);

  async function handleToggleEnabled(): Promise<void> {
    await mcpService.setEnabled(server.id, !server.enabled);
  }

  async function handleUninstall(): Promise<void> {
    uninstalling = true;
    try {
      await mcpService.uninstall(server.id);
    } finally {
      uninstalling = false;
    }
  }

  const badgeColor = $derived(statusBadgeColor(server.status));
  const transportText = $derived(transportLabel(server.transportKind));
</script>

<div class="server-card">
  <div class="card-header">
    <div class="card-title-row">
      <span class="server-name">{server.displayName}</span>
      <span class="status-badge" style:color={badgeColor}>{server.status}</span>
    </div>
    {#if server.description}
      <p class="server-description">{server.description}</p>
    {/if}
  </div>

  <div class="card-meta">
    <span class="meta-item">Transport: {transportText}</span>
    <span class="meta-item">{server.toolsCount} tools</span>
  </div>

  <div class="card-actions">
    <label class="toggle-label">
      <input
        type="checkbox"
        checked={server.enabled}
        onchange={handleToggleEnabled}
      />
      {server.enabled ? 'Enabled' : 'Disabled'}
    </label>
    <button
      class="btn-danger uninstall-btn"
      onclick={handleUninstall}
      disabled={uninstalling}
    >
      {uninstalling ? 'Uninstalling…' : 'Uninstall'}
    </button>
  </div>
</div>

<style>
  .server-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md, 8px);
    padding: var(--space-3, 12px);
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    background: var(--bg-secondary);
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .server-name {
    font-weight: 600;
    font-size: var(--font-size-sm);
    flex: 1;
  }

  .status-badge {
    font-size: var(--font-size-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .server-description {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .card-meta {
    display: flex;
    gap: var(--space-3, 12px);
  }

  .meta-item {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-xs);
    cursor: pointer;
    flex: 1;
  }

  .uninstall-btn {
    font-size: var(--font-size-xs);
    padding: 4px 10px;
    border-radius: var(--radius-sm, 4px);
    border: none;
    cursor: pointer;
  }

  .uninstall-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
