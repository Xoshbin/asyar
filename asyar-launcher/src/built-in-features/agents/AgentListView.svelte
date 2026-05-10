<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { agentService } from './agentService.svelte';
  import { agentsManager } from './agentsManager.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import {
    buildAgentRowProps,
    handleSelectAgentForChat,
  } from './agentListView.helpers';
  import ListItem from '../../components/list/ListItem.svelte';
  import EmptyState from '../../components/feedback/EmptyState.svelte';

  const deps = $derived({ service: agentService, manager: agentsManager, viewManager });
  const agents = $derived(agentService.agents);
  const selectedAgentId = $derived(agentsManager.currentAgentId);

  // Default selection on first paint when nothing is highlighted yet.
  $effect(() => {
    if (agents.length > 0 && !agentsManager.currentAgentId) {
      agentsManager.currentAgentId = agents[0].id;
    }
  });

  function moveSelection(direction: 1 | -1) {
    if (agents.length === 0) return;
    const currentId = agentsManager.currentAgentId;
    const idx = currentId ? agents.findIndex((a) => a.id === currentId) : -1;
    let nextIdx: number;
    if (idx === -1) {
      nextIdx = direction === 1 ? 0 : agents.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(agents.length - 1, idx + direction));
    }
    if (nextIdx !== idx) {
      agentsManager.currentAgentId = agents[nextIdx].id;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // When the action panel (Cmd+K) is open, let it own keyboard navigation.
    if (document.querySelector('.action-popup')) return;
    if (event.key === 'ArrowUp') {
      moveSelection(-1);
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'ArrowDown') {
      moveSelection(1);
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'Enter') {
      // Open chat for the highlighted agent when the launcher search bar
      // is empty. When the bar has text, the launcher's `onViewSubmit`
      // path handles the keystroke (we don't want to swallow it here).
      if (searchStores.query.trim() !== '') return;
      const agentId = agentsManager.currentAgentId;
      if (!agentId) return;
      handleSelectAgentForChat(agentId, deps);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleWindowKeydown, true);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleWindowKeydown, true);
  });
</script>

<div class="agents-list-view">
  {#if agents.length === 0}
    <EmptyState
      message="No agents yet"
      description="Open Actions (⌘K) and pick “New Agent” to create one."
    />
  {:else}
    <div class="agents-list custom-scrollbar">
      {#each agents as agent (agent.id)}
        {@const row = buildAgentRowProps(agent)}
        <ListItem
          title={row.title}
          subtitle={row.subtitle}
          selected={selectedAgentId === agent.id}
          onclick={() => handleSelectAgentForChat(agent.id, deps)}
        />
      {/each}
    </div>
    <footer class="list-footer">
      <kbd>↑</kbd><kbd>↓</kbd> to select · <kbd>Enter</kbd> to chat · <kbd>⌘K</kbd> for actions
    </footer>
  {/if}
</div>

<style>
  .agents-list-view {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .agents-list {
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    flex: 1;
    overflow-y: auto;
  }

  .list-footer {
    padding: 8px 16px;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    border-top: 1px solid var(--border-color);
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }

  .list-footer kbd {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    padding: 1px 5px;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }
</style>
