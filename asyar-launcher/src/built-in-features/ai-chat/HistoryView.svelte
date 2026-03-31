<script lang="ts">
  import { onMount } from 'svelte';
  import { aiStore } from './aiStore.svelte';
  import { EmptyState, ListItem, ListItemActions, ConfirmDialog } from '../../components';

  let { extensionManager } = $props();

  let selectedIndex = $state(0);
  let items = $derived(aiStore.conversationHistory);

  let confirmOpen = $state(false);
  let pendingDelete = $state<(typeof items)[0] | null>(null);

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
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const toDelete = items[selectedIndex];
        if (toDelete) {
            pendingDelete = toDelete;
            confirmOpen = true;
        }
    }
  }

  function selectConversation(id: string) {
    aiStore.loadConversation(id);
    extensionManager?.navigateToView('ai-chat/ChatView');
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    aiStore.deleteConversation(pendingDelete.id);
    if (selectedIndex >= items.length && items.length > 0) {
      selectedIndex = items.length - 1;
    }
    pendingDelete = null;
  }

  function scrollIntoView() {
    requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>('.history-container');
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
      if (!el) return;
      const containerRect = container.getBoundingClientRect();
      const elementRect = el.getBoundingClientRect();
      if (elementRect.top < containerRect.top) {
        el.scrollIntoView({ block: 'start', behavior: 'auto' });
      } else if (elementRect.bottom > containerRect.bottom) {
        el.scrollIntoView({ block: 'end', behavior: 'auto' });
      }
    });
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

<div class="view-container">
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
               <ListItemActions>
                 <button class="action-btn delete" onclick={(e) => { e.stopPropagation(); pendingDelete = conv; confirmOpen = true; }} title="Delete">
                   <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                     <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                   </svg>
                 </button>
               </ListItemActions>
            {/snippet}
          </ListItem>
        {/each}
      </div>
    {/if}
  </div>

  <ConfirmDialog
    bind:isOpen={confirmOpen}
    title="Delete conversation"
    message={`Delete "${pendingDelete?.title || 'this chat'}"? This cannot be undone.`}
    confirmButtonText="Delete"
    variant="danger"
    onconfirm={handleConfirmDelete}
    oncancel={() => { pendingDelete = null; }}
  />
</div>

<style>
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

