<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mcpService } from './mcpService.svelte';
  import EmptyState from '../../components/feedback/EmptyState.svelte';
  import LoadingState from '../../components/feedback/LoadingState.svelte';
  import Badge from '../../components/base/Badge.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { isAnyModalOpen } from '../../components/base/Modal.logic';
  import { t } from '../../services/i18n';

  let loading = $state(false);
  let selectedIndex = $state(0);

  const selectedRow = $derived(mcpService.permissions[selectedIndex] ?? null);

  async function load(): Promise<void> {
    loading = true;
    try {
      await mcpService.refreshPermissions();
    } finally {
      loading = false;
    }
  }

  async function handleRevoke(serverId: string, toolId: string, agentId: string): Promise<void> {
    await mcpService.deletePermission(serverId, toolId, agentId);
  }

  function decisionVariant(decision: string): 'success' | 'info' | 'danger' | 'default' {
    if (decision === 'allow_always') return 'success';
    if (decision === 'allow_once') return 'info';
    if (decision === 'never') return 'danger';
    return 'default';
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (document.querySelector('.action-popup') || isAnyModalOpen(document)) return;
    const count = mcpService.permissions.length;
    if (count === 0) return;
    if (event.key === 'ArrowDown') {
      selectedIndex = Math.min(count - 1, selectedIndex + 1);
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'ArrowUp') {
      selectedIndex = Math.max(0, selectedIndex - 1);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  $effect(() => {
    const count = mcpService.permissions.length;
    if (selectedIndex >= count && count > 0) {
      selectedIndex = count - 1;
    } else if (count === 0) {
      selectedIndex = 0;
    }
  });

  $effect(() => {
    const row = selectedRow;
    if (!row) {
      actionService.unregisterAction('mcp:revoke-permission');
      return;
    }
    actionService.registerAction({
      id: 'mcp:revoke-permission',
      label: t('features.mcp.ui.revoke'),
      icon: '🗑️',
      shortcut: 'Control+X',
      confirm: true,
      destructive: true,
      category: t('categories.mcp'),
      extensionId: 'mcp',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleRevoke(row.serverId, row.toolId, row.agentId),
    });
    return () => {
      actionService.unregisterAction('mcp:revoke-permission');
    };
  });

  onMount(() => {
    window.addEventListener('keydown', handleWindowKeydown, true);
    void load();
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleWindowKeydown, true);
    actionService.unregisterAction('mcp:revoke-permission');
  });
</script>

<div class="permissions-view custom-scrollbar">
  {#if loading}
    <LoadingState message={t('common.loading_ellipsis')} />
  {:else if mcpService.permissions.length === 0}
    <EmptyState
      message={t('features.mcp.no_permissions')}
      description={t('features.mcp.no_permissions_description')}
    />
  {:else}
    <table class="permissions-table" role="grid">
      <thead>
        <tr>
          <th>{t('features.mcp.ui.col_server')}</th>
          <th>{t('features.mcp.ui.col_tool')}</th>
          <th>{t('features.mcp.ui.col_agent')}</th>
          <th>{t('features.mcp.ui.col_decision')}</th>
        </tr>
      </thead>
      <tbody>
        {#each mcpService.permissions as row, index (row.serverId + '/' + row.toolId + '/' + row.agentId)}
          <tr
            class="permission-row"
            class:selected={index === selectedIndex}
            aria-selected={index === selectedIndex}
            onclick={() => {
              selectedIndex = index;
            }}
          >
            <td class="cell-mono">{row.serverId}</td>
            <td class="cell-mono">{row.toolId}</td>
            <td class="cell-secondary">{row.agentId || '—'}</td>
            <td>
              <Badge
                text={row.decision.replace('_', ' ')}
                variant={decisionVariant(row.decision)}
              />
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

  .permission-row.selected {
    background: var(--bg-selected);
  }
</style>
