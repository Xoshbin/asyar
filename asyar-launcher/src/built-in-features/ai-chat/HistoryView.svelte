<script lang="ts">
  import { onMount } from 'svelte';
  import { aiStore } from './aiStore.svelte';

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
    const el = document.querySelector(`.history-item[data-index="${selectedIndex}"]`);
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

<div class="history-view">
  <div class="history-container">
    {#if items.length === 0}
      <div class="empty-state">
        <div class="empty-icon">🕒</div>
        <h2>No history yet</h2>
        <p>Your AI conversations will appear here.</p>
        <button class="start-btn" onclick={() => extensionManager?.navigateToView('ai-chat/ChatView')}>Start a new chat</button>
      </div>
    {:else}
      <div class="history-list">
        {#each items as conv, i (conv.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div 
            class="history-item" 
            class:selected={i === selectedIndex}
            data-index={i}
            onclick={() => selectConversation(conv.id)}
          >
            <div class="item-content">
              <div class="item-title">{conv.title || 'Untitled Conversation'}</div>
              <div class="item-meta">
                <span class="item-date">{formatRelativeTime(conv.createdAt)}</span>
                <span class="dot">·</span>
                <span class="item-msg-count">{conv.messages.length} messages</span>
              </div>
            </div>
            <div class="item-actions">
               <button class="action-btn delete" onclick={(e) => { e.stopImmediatePropagation(); if(confirm('Delete?')) aiStore.deleteConversation(conv.id); }} title="Delete">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                 </svg>
               </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .history-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .history-container {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    height: 100%;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
  }

  .history-item {
    display: flex;
    align-items: center;
    padding: 14px 24px;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid transparent;
    background: transparent;
    margin-bottom: 2px;
  }

  .history-item:hover {
    background: var(--bg-hover);
  }

  .history-item.selected {
    background: var(--bg-tertiary);
    border-color: var(--accent-primary);
  }

  .item-content {
    flex: 1;
    min-width: 0;
  }

  .item-title {
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-meta {
    font-size: 12px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dot { font-size: 10px; opacity: 0.5; }

  .item-actions {
    opacity: 0;
    transition: opacity 0.2s;
  }
  .history-item:hover .item-actions,
  .history-item.selected .item-actions {
    opacity: 1;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    transition: all 0.2s;
  }
  .action-btn:hover { background: var(--bg-secondary); }
  .action-btn.delete:hover { color: var(--accent-danger, #ff3b30); background: rgba(255, 59, 48, 0.1); }

  .empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-tertiary);
  }
  .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
  .empty-state h2 { color: var(--text-primary); margin-bottom: 8px; }
  .start-btn {
    margin-top: 20px;
    background: var(--accent-primary);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .start-btn:hover { opacity: 0.9; }

  /* Custom scrollbar */
  .history-container::-webkit-scrollbar { width: 6px; }
  .history-container::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 10px; }
</style>
