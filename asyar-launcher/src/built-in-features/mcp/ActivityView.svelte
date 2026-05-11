<script lang="ts">
  import { onMount } from 'svelte';
  import { mcpService } from './mcpService.svelte';
  import { formatRelativeTime, truncateArgs } from './manageServersView.helpers';
  import EmptyState from '../../components/feedback/EmptyState.svelte';

  const audit = $derived(mcpService.audit);

  onMount(() => {
    void mcpService.refreshAudit();
  });
</script>

<div class="activity-view">
  {#if audit.length === 0}
    <EmptyState
      message="No MCP activity yet"
      description="Tool calls made by AI agents through MCP servers appear here."
    />
  {:else}
    <ul class="audit-list custom-scrollbar">
      {#each audit as row (row.id)}
        <li class="audit-row">
          <span class="audit-time">{formatRelativeTime(row.calledAt)}</span>
          <span class="audit-tool">{row.serverId}.{row.toolId}</span>
          <span
            class="audit-status"
            class:success={row.success}
            class:failure={!row.success}
          >
            {row.success ? '✓' : '✗'}
          </span>
          {#if row.argsSummary}
            <span class="audit-args">{truncateArgs(row.argsSummary)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .activity-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .audit-list {
    list-style: none;
    margin: 0;
    padding: var(--space-3, 12px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .audit-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-sm);
    padding: 4px 0;
  }

  .audit-time {
    color: var(--text-tertiary);
    white-space: nowrap;
    min-width: 70px;
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
    max-width: 280px;
  }
</style>
