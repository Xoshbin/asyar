<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { agentService } from './agentService.svelte';
  import { agentsManager } from './agentsManager.svelte';
  import { renderMarkdown, handleMarkdownCopyClick } from '../../utils/markdown';
  import { logService } from '../../services/log/logService';
  import {
    extractTextFromMessage,
    extractToolUsesFromMessage,
    messageBubbleVariant,
  } from './agentChatView.helpers';
  import EmptyState from '../../components/feedback/EmptyState.svelte';
  import ThreadListSidebar from './ThreadListSidebar.svelte';
  import type { AgentDef, ThreadDef, MessageDef } from './types';

  const agentId = $derived(agentsManager.currentAgentId);
  let agent = $state<AgentDef | null>(null);
  let threads = $state<ThreadDef[]>([]);
  let messages = $state<MessageDef[]>([]);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let userScrolledUp = $state(false);
  let loadError = $state<string | null>(null);

  const selectedThreadId = $derived(agentsManager.currentThreadId);
  const sending = $derived(agentsManager.sending);
  const streamingText = $derived(agentsManager.streamingText);

  // Load agent + threads when currentAgentId changes
  $effect(() => {
    void (async () => {
      if (!agentId) {
        agent = null;
        threads = [];
        messages = [];
        return;
      }
      agent = agentService.getById(agentId) ?? null;
      try {
        threads = await agentService.listThreads(agentId);
        if (threads.length === 0) {
          // Don't auto-create — first send creates one via index.ts onViewSubmit
          agentsManager.currentThreadId = null;
        } else if (!agentsManager.currentThreadId || !threads.some((t) => t.id === agentsManager.currentThreadId)) {
          agentsManager.currentThreadId = threads[0].id;
        }
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    })();
  });

  // Reload messages when thread changes OR when sending toggles
  // (so persisted assistant messages take over from the streaming buffer).
  $effect(() => {
    void (async () => {
      const tid = agentsManager.currentThreadId;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      agentsManager.sending;
      if (!tid) {
        messages = [];
        return;
      }
      try {
        messages = await agentService.listMessages(tid);
        // Refresh threads too — title may have been auto-set on first send.
        if (agentId) threads = await agentService.listThreads(agentId);
      } catch (err) {
        logService.warn(`[agents] listMessages failed: ${err}`);
      }
    })();
  });

  $effect(() => {
    // Scroll-to-bottom when messages or streaming buffer changes.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    messages.length;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    streamingText;
    if (!userScrolledUp) scrollToBottom();
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

  function copyText(text: string) {
    void navigator.clipboard.writeText(text).catch(() => {});
  }

  function onSelectThread(threadId: string) {
    agentsManager.currentThreadId = threadId;
  }

  /**
   * Move thread selection up or down. Wrapping is disabled — top/bottom of
   * the list is a hard stop so the user can tell visually when they're at
   * an edge.
   */
  function moveThreadSelection(direction: 1 | -1) {
    if (threads.length === 0) return;
    const currentId = agentsManager.currentThreadId;
    const idx = currentId ? threads.findIndex((t) => t.id === currentId) : -1;
    let nextIdx: number;
    if (idx === -1) {
      nextIdx = direction === 1 ? 0 : threads.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(threads.length - 1, idx + direction));
    }
    if (nextIdx !== idx) {
      agentsManager.currentThreadId = threads[nextIdx].id;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    // Skip when modifiers are held — those are launcher / OS shortcuts.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // When the action panel (Cmd+K) is open, let it own keyboard navigation.
    if (document.querySelector('.action-popup')) return;
    if (event.key === 'ArrowUp') {
      moveThreadSelection(-1);
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'ArrowDown') {
      moveThreadSelection(1);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onMount(async () => {
    // capture: true so we run before the launcher's keyboard handler.
    window.addEventListener('keydown', handleWindowKeydown, true);
    await tick();
    scrollToBottom();
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleWindowKeydown, true);
    // Intentionally do NOT abort the active controller here. The user can
    // navigate away (Esc to launcher) and the run should keep streaming so
    // they can come back and see the result, or watch progress in Runs.
    // To cancel, the user uses the Cancel Run action (⌘K).
  });
</script>

<div class="agent-chat-view">
  {#if !agentId}
    <EmptyState message="No agent selected" description="Pick an agent from the launcher to start a chat." />
  {:else if !agent}
    <EmptyState message="Loading agent…" />
  {:else}
    <div class="chat-layout">
      <ThreadListSidebar
        threads={threads}
        selectedThreadId={selectedThreadId}
        onSelectThread={onSelectThread}
      />
      <div class="chat-main">
        <header class="chat-header">
          <h2>{agent.name}</h2>
          {#if sending}
            <span class="streaming-tag">Streaming… ⌘K to cancel</span>
          {/if}
        </header>

        <div class="messages-container custom-scrollbar" bind:this={messagesEl} onscroll={handleScroll} role="log">
          {#if loadError}
            <p class="error">{loadError}</p>
          {:else if messages.length === 0 && !sending}
            <EmptyState
              message="Start chatting"
              description="Type a message to begin."
            />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="messages-list" onclick={handleMarkdownCopyClick}>
              {#each messages as message (message.id)}
                {@const variant = messageBubbleVariant(message)}
                {@const text = extractTextFromMessage(message)}
                {@const toolUses = extractToolUsesFromMessage(message)}
                <div class="message-row {variant}">
                  {#if variant === 'assistant'}
                    <div class="avatar assistant-avatar">AI</div>
                  {:else if variant === 'user'}
                    <div class="avatar user-avatar">You</div>
                  {:else}
                    <div class="avatar tool-avatar">⚙</div>
                  {/if}
                  <div class="message-bubble {variant}">
                    {#if variant === 'assistant'}
                      {#if text.length > 0}
                        <div class="md-content">{@html renderMarkdown(text)}</div>
                      {/if}
                      {#each toolUses as tu (tu.id)}
                        <div class="tool-use-chip">
                          <span class="chip-name">{tu.name}</span>
                          <pre class="chip-input">{JSON.stringify(tu.input, null, 2)}</pre>
                        </div>
                      {/each}
                    {:else if variant === 'tool'}
                      <pre class="tool-result">{text}</pre>
                    {:else}
                      <span class="user-text">{text}</span>
                    {/if}
                    <button
                      class="copy-message-btn"
                      onclick={() => copyText(text)}
                      title="Copy message"
                      tabindex="-1"
                      aria-label="Copy message"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    </button>
                  </div>
                </div>
              {/each}

              {#if sending && streamingText.length > 0}
                <div class="message-row assistant">
                  <div class="avatar assistant-avatar">AI</div>
                  <div class="message-bubble assistant">
                    <div class="md-content">{@html renderMarkdown(streamingText)}</div>
                    <span class="streaming-cursor">▊</span>
                  </div>
                </div>
              {:else if sending}
                <div class="message-row assistant">
                  <div class="avatar assistant-avatar">AI</div>
                  <div class="message-bubble assistant"><span class="streaming-cursor">▊</span></div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .agent-chat-view {
    display: flex;
    height: 100%;
  }
  .chat-layout {
    display: flex;
    width: 100%;
    gap: 1px;
  }
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
  }
  .chat-header h2 {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .streaming-tag {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
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
  .tool-avatar { background: var(--bg-tertiary); color: var(--text-tertiary); border: 1px solid var(--border-color); }

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
  .message-bubble.tool {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-sm);
    border-top-left-radius: var(--radius-xs);
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

  .tool-use-chip {
    margin-top: 8px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
  }
  .chip-name {
    font-weight: 600;
    color: var(--text-secondary);
  }
  .chip-input, .tool-result {
    margin: 4px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .streaming-cursor {
    display: inline-block;
    color: var(--accent-primary);
    font-weight: bold;
    animation: blink 0.8s step-end infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  .error {
    color: var(--color-error, #ef4444);
    padding: 16px;
    margin: 0;
  }
</style>
