<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { aiStore } from './aiStore.svelte';
  import { stopStream } from '../../services/ai/aiEngine';
  import { renderMarkdown, handleMarkdownCopyClick } from '../../utils/markdown';
  import { renderMermaidDiagrams } from '../../utils/mermaid';
  import { getProvider } from '../../services/ai/providerRegistry';
  import { EmptyState, Button } from '../../components';
  import { showSettingsWindow } from '../../lib/ipc/commands';

  let { extensionManager = undefined, initialQuery = $bindable(undefined) } = $props();

  let messagesEl = $state<HTMLDivElement | null>(null);
  let userScrolledUp = $state(false);

  $effect(() => {
    aiStore.currentConversation;
    if (!userScrolledUp) scrollToBottom();
  });

  onMount(async () => {
    await tick();
    if (initialQuery) {
      initialQuery = undefined;
    }
  });

  function scrollToBottom() {
    if (messagesEl) {
      requestAnimationFrame(() => {
        messagesEl!.scrollTop = messagesEl!.scrollHeight;
      });
    }
  }

  function handleScroll() {
    if (!messagesEl) return;
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
    userScrolledUp = !atBottom;
  }

  function handleStop() {
    const id = aiStore.currentStreamId;
    if (id) stopStream(id);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(err => console.warn('[ChatView] Copy to clipboard failed:', err));
  }


  let messages = $derived(aiStore.currentConversation?.messages ?? []);
  let configured = $derived(aiStore.isConfigured);

  $effect(() => {
    if (extensionManager) {
      const ai = aiStore.settings;
      if (configured && ai.activeProviderId) {
        const plugin = getProvider(ai.activeProviderId);
        const providerLabel = plugin?.name ?? ai.activeProviderId;
        const modelLabel = ai.activeModelId ?? 'unknown model';
        extensionManager.setActiveViewSubtitle(`${providerLabel} · ${modelLabel}`);
      } else {
        extensionManager.setActiveViewSubtitle(null);
      }
    }
  });

  onDestroy(() => {
    if (extensionManager) {
      extensionManager.setActiveViewSubtitle(null);
    }
  });

  // Mermaid Rendering Effect
  $effect(() => {
    // Re-run when messages change or a message stops streaming
    const currentMessages = messages;
    const isAnyStreaming = currentMessages.some(m => m.isStreaming);
    
    if (!isAnyStreaming && messagesEl) {
      // Small tick to ensure the DOM is updated with the latest markdown HTML
      tick().then(() => renderMermaidDiagrams(messagesEl!));
    }
  });
</script>

<div class="view-container">
  <div class="chat-main">
    <div class="messages-container custom-scrollbar" bind:this={messagesEl} onscroll={handleScroll} role="log">
      {#if !configured}
        <EmptyState message="AI Chat" description="Configure your AI provider in Settings to start chatting.">
          {#snippet icon()}
            <span class="text-4xl">🤖</span>
          {/snippet}
          <Button onclick={() => showSettingsWindow('ai')}>Set up Provider</Button>
        </EmptyState>
      {:else if messages.length === 0}
        <EmptyState message="How can I help you today?" description="Type your message in the search bar above to start a conversation.">
          {#snippet icon()}
            <span class="text-4xl">✨</span>
          {/snippet}
        </EmptyState>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="messages-list" onclick={handleMarkdownCopyClick}>
          {#each messages as message (message.id)}
            <div class="message-row {message.role}" class:streaming={message.isStreaming}>
              {#if message.role === 'assistant'}
                <div class="avatar assistant-avatar">AI</div>
              {/if}
              <div class="message-bubble {message.role}">
                {#if message.role === 'assistant'}
                  <div class="md-content">{@html renderMarkdown(message.content)}</div>
                  {#if message.isStreaming}
                    <span class="streaming-cursor">▊</span>
                  {/if}
                 {:else}
                  <span class="user-text">{message.content}</span>
                {/if}
                <button class="copy-message-btn" onclick={() => copyText(message.content)} title="Copy message" tabindex="-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
              </div>
              {#if message.role === 'user'}
                <div class="avatar user-avatar">You</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 16px;
  }

  .message-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .message-row.user { flex-direction: row-reverse; }

  .avatar {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs);
    font-weight: 700;
    margin-top: 2px;
  }
  .assistant-avatar { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
  .user-avatar { background: var(--accent-primary); color: white; }

  .message-bubble {
    position: relative;
    max-width: 85%;
    padding: 10px 14px;
    border-radius: var(--radius-xl);
    font-size: var(--font-size-base);
    line-height: 1.55;
    word-break: break-word;
  }
  .message-bubble.assistant {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-top-left-radius: var(--radius-xs);
  }
  .message-bubble.user {
    background: var(--accent-primary);
    color: white;
    border-top-right-radius: var(--radius-xs);
  }

  .copy-message-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity 0.12s;
    padding: 2px;
  }
  .message-bubble:hover .copy-message-btn { opacity: 1; }
  .message-bubble.user .copy-message-btn { color: rgba(255,255,255,0.6); }

  .setup-btn {
    margin-top: 10px;
  }

  .streaming-cursor {
    display: inline-block;
    color: var(--accent-primary);
    font-weight: bold;
    animation: blink 0.8s step-end infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
</style>
