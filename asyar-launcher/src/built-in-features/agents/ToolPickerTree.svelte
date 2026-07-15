<script lang="ts">
  import { toggleToolSelection } from './agentEditView.helpers';
  import type { AgentToolGroup } from '../../lib/ipc/commands';
  import Checkbox from '../../components/base/Checkbox.svelte';
  import { mcpService } from '../mcp/mcpService.svelte';

  let {
    groups,
    selectedIds,
    onChange,
  }: {
    groups: AgentToolGroup[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
  } = $props();

  let collapsed = $state<Record<string, boolean>>({});

  function groupKey(g: AgentToolGroup): string {
    if (g.kind === 'builtin') return 'builtin';
    if (g.kind === 'tier2') return `tier2:${g.extensionId}`;
    return `mcp:${g.serverId}`;
  }

  function groupLabel(g: AgentToolGroup): string {
    if (g.kind === 'builtin') return 'Built-in';
    if (g.kind === 'tier2') return g.extensionId;
    const server = mcpService.servers.find((s) => s.id === g.serverId);
    return server?.displayName ?? g.serverId;
  }
</script>

<div class="tool-picker">
  {#each groups as group (groupKey(group))}
    {@const key = groupKey(group)}
    <button class="group-header" onclick={() => (collapsed[key] = !collapsed[key])}>
      {collapsed[key] ? '▸' : '▾'}
      {groupLabel(group)}
    </button>
    {#if !collapsed[key]}
      <div class="group-items">
        {#each group.tools as tool (tool.fullyQualifiedId)}
          <label class="tool-row" title={tool.description}>
            <Checkbox
              checked={selectedIds.includes(tool.fullyQualifiedId)}
              onchange={() => onChange(toggleToolSelection(selectedIds, tool.fullyQualifiedId))}
            />
            <span>{tool.name}</span>
          </label>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .tool-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: 500;
    padding: var(--space-1) 0;
    text-align: left;
    user-select: none;
    transition: color var(--transition-smooth);
  }

  .group-header:hover {
    color: var(--text-primary);
  }

  .group-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-left: var(--space-3);
  }

  .tool-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }
</style>
