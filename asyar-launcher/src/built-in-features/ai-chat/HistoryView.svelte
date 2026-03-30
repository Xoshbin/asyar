<script lang="ts">
  import { onMount } from 'svelte';
  import { aiStore } from './aiStore.svelte';
  import { EmptyState, ListItem } from '../../components';

  let { extensionManager } = $props();

  let selectedIndex = $state(0);
  let items = $derived(aiStore.conversationHistory);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      scrollIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      scrollIntoView();
    } else if (e.key === 'Enter') {
      if (items[selectedIndex]) {
        selectConversation(items[selectedIndex].id);
      }
    } else if (e.key === 'Escape') {
      extensionManager?.goBack();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        const toDelete = items[selectedIndex];
        if (toDelete && confirm(`Delete "${toDelete.title || 'this chat'}"?`)) {
            aiStore.deleteConversation(toDelete.id);
            if (selectedIndex >= items.length && items.length > 0) {
                selectedIndex = items.length - 1;
            }
        }
    }
  }

  function selectConversation(id: string) {
    aiStore.loadConversation(id);
    extensionManager?.navigateToView('ai-chat/ChatView');
  }

  function scrollIntoView() {
    const el = document.querySelector(`.list-row[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function formatRelativeTime(timestamp: number) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="view-container history-view">
  <div class="history-container custom-scrollbar">
    {#if items.length === 0}
      <EmptyState 
        message="No history yet" 
        description="Your AI conversations will appear here."
      >
        {#snippet icon()}
          <span class="text-4xl opacity-50">🕒</span>
        {/snippet}
        <button class="btn-primary mt-4" onclick={() => extensionManager?.navigateToView('ai-chat/ChatView')}>Start a new chat</button>
      </EmptyState>
    {:else}
      <div class="history-list">
        {#each items as conv, i (conv.id)}
          <ListItem 
            title={conv.title || 'Untitled Conversation'}
            selected={i === selectedIndex}
            onclick={() => selectConversation(conv.id)}
            data-index={i}
          >
            {#snippet subtitle()}
               <div class="flex items-center gap-2">
                 <span>{formatRelativeTime(conv.createdAt)}</span>
                 <span class="opacity-30">·</span>
                 <span>{conv.messages.length} messages</span>
               </div>
            {/snippet}
            {#snippet trailing()}
               <div class="item-actions">
                 <button class="action-btn delete" onclick={(e) => { e.stopPropagation(); if(confirm('Delete?')) aiStore.deleteConversation(conv.id); }} title="Delete">
                   <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                     <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                   </svg>
                 </button>
               </div>
            {/snippet}
          </ListItem>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .history-view {
    height: 100%;
  }

  .history-container {
    flex: 1;
    overflow-y: auto;
    height: 100%;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .item-actions {
    opacity: 0;
    transition: opacity 0.2s;
  }
  
  :global(.list-row:hover) .item-actions,
  :global(.list-row.selected) .item-actions {
    opacity: 1;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--radius-sm);
    transition: all 0.2s;
  }
  .action-btn:hover { background: var(--bg-secondary); }
  .action-btn.delete:hover { color: var(--accent-danger); background: color-mix(in srgb, var(--accent-danger) 12%, transparent); }
</style>

