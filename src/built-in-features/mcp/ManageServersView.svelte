<script lang="ts">
  import { onMount } from 'svelte';
  import { mcpService } from './mcpService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { formatRelativeTime, truncateArgs } from './manageServersView.helpers';
  import ServerCard from './ServerCard.svelte';

  const servers = $derived(mcpService.servers);
  const audit = $derived(mcpService.audit);
  const detectedConfigs = $derived(mcpService.detectedConfigs);
  const loading = $derived(mcpService.loading);
  const strictMode = $derived(mcpService.strictMode);

  // Hydrate state when the view opens — covers cold launch where this view
  // is the first to query the MCP feature.
  onMount(() => {
    void mcpService.refresh();
  });

  async function handleStrictModeChange(event: Event): Promise<void> {
    const next = (event.target as HTMLInputElement).checked;
    await mcpService.setStrictMode(next);
  }

  function goInstall(): void {
    viewManager.navigateToView('mcp/InstallServerView');
  }

  function goImport(): void {
    viewManager.navigateToView('mcp/ImportServersView');
  }

  function goPermissions(): void {
    viewManager.navigateToView('mcp/PermissionsView');
  }

  async function handleRefresh(): Promise<void> {
    await mcpService.refresh();
  }
</script>

<div class="manage-view">
  <header class="view-header">
    <h2 class="view-title">MCP Servers</h2>
    <div class="header-actions">
      <button class="btn" onclick={handleRefresh} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
      <button class="btn" onclick={goPermissions}>Permissions</button>
      <button class="btn" onclick={goImport}>Import</button>
      <button class="btn btn-primary" onclick={goInstall}>Install</button>
    </div>
  </header>

  <label class="strict-mode-toggle" title="When on, every MCP tool call asks for permission on first use, even tools whose names look read-only.">
    <input
      type="checkbox"
      checked={strictMode}
      onchange={handleStrictModeChange}
    />
    <span class="strict-mode-label">
      Always ask before tool calls
      <span class="strict-mode-hint">(strict mode — recommended for untrusted servers)</span>
    </span>
  </label>

  {#if loading}
    <div class="loading-state">Loading servers…</div>
  {:else if servers.length === 0}
    <div class="empty-state">
      {#if detectedConfigs.length > 0}
        <p>
          We found existing MCP configs from
          {detectedConfigs.map((c) => c.source).join(', ')}.
          Want to import them?
        </p>
        <button class="btn btn-primary" onclick={goImport}>Import Detected Configs</button>
      {:else}
        <p>No MCP servers installed yet.</p>
        <button class="btn btn-primary" onclick={goInstall}>Install a Server</button>
      {/if}
    </div>
  {:else}
    <div class="server-list custom-scrollbar">
      {#each servers as server (server.id)}
        <ServerCard {server} />
      {/each}
    </div>
  {/if}

  <section class="audit-section">
    <h3 class="audit-title">Recent MCP Activity</h3>
    {#if audit.length === 0}
      <p class="audit-empty">No MCP activity yet.</p>
    {:else}
      <ul class="audit-list custom-scrollbar">
        {#each audit as row (row.id)}
          <li class="audit-row">
            <span class="audit-time">{formatRelativeTime(row.calledAt)}</span>
            <span class="audit-tool">{row.serverId}.{row.toolId}</span>
            <span class="audit-status" class:success={row.success} class:failure={!row.success}>
              {row.success ? '✓' : '✗'}
            </span>
            {#if row.argsSummary}
              <span class="audit-args">{truncateArgs(row.argsSummary)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .manage-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .view-header {
    display: flex;
    align-items: center;
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-bottom: 1px solid var(--border-color);
    gap: var(--space-2, 8px);
  }

  .view-title {
    flex: 1;
    margin: 0;
    font-size: var(--font-size-base);
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    gap: var(--space-2, 8px);
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3, 12px);
    flex: 1;
    padding: var(--space-6, 24px);
    color: var(--text-secondary);
    text-align: center;
  }

  .server-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-3, 12px);
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }

  .audit-section {
    border-top: 1px solid var(--border-color);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    max-height: 200px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .audit-title {
    margin: 0 0 var(--space-2, 8px);
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
  }

  .audit-empty {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin: 0;
  }

  .audit-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .audit-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-xs);
    padding: 2px 0;
  }

  .audit-time {
    color: var(--text-tertiary);
    white-space: nowrap;
    min-width: 60px;
  }

  .audit-tool {
    font-family: var(--font-mono, monospace);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .audit-status.success {
    color: var(--accent-success);
  }

  .audit-status.failure {
    color: var(--accent-danger);
  }

  .audit-args {
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .strict-mode-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-4, 16px);
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    font-size: 13px;
  }

  .strict-mode-toggle input {
    cursor: pointer;
  }

  .strict-mode-label {
    color: var(--text-primary);
  }

  .strict-mode-hint {
    color: var(--text-tertiary);
    font-size: 12px;
    margin-left: var(--space-1, 4px);
  }
</style>
