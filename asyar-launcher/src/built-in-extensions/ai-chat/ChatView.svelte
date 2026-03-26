<script lang="ts">
  import { onMount, onDestroy, tick, afterUpdate } from 'svelte';
  import {
    aiSettings, currentConversation, isConfigured,
    addUserMessage, beginAssistantMessage, appendStreamToken,
    finalizeAssistantMessage, failAssistantMessage, clearConversation,
    type AIMessage, type AIConversation,
  } from './aiStore';
  import { streamChat, stopStream } from './aiService';
  import SettingsView from './SettingsView.svelte';

  // extensionManager is required by the extension view contract
  export let extensionManager: any = undefined;
  // Silencing lint about unused prop, as it's part of the contract
  $: if (extensionManager) { /* used by contract */ }

  let isStreaming = false;
  let showSettings = false;
  let messagesEl: HTMLDivElement;
  let userScrolledUp = false;

  const unsubConv = currentConversation.subscribe(() => {
    if (!userScrolledUp) scrollToBottom();
  });
  onDestroy(() => unsubConv());

  // When the view opens with an initial query (from "Ask AI" result)
  export let initialQuery: string | undefined = undefined;
  onMount(async () => {
    await tick();
    if (initialQuery) {
      // Logic handled by AIChatExtension.onActivate or onViewSubmit
      initialQuery = undefined;
    }
  });

  afterUpdate(() => {
    if (!userScrolledUp) scrollToBottom();
  });

  function scrollToBottom() {
    if (messagesEl) {
      requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  }

  function handleScroll() {
    if (!messagesEl) return;
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
    userScrolledUp = !atBottom;
  }

  function handleStop() {
    stopStream();
    isStreaming = false;
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  /** Minimal Markdown → HTML renderer (bold, italic, code, code blocks) */
  function renderMarkdown(text: string): string {
    let out = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks
    const codeBlocks: string[] = [];
    out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.length;
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      codeBlocks.push(
        `<div class="code-block"><div class="code-header">${langLabel}<button class="copy-btn" data-code="${encodeURIComponent(code.trimEnd())}">Copy</button></div><pre><code>${code.trimEnd()}</code></pre></div>`
      );
      return `\x00CODE${idx}\x00`;
    });

    // Inline code
    out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Headers
    out = out.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    out = out.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    out = out.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
    // Unordered lists
    out = out.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>');
    out = out.replace(/(<li[^>]*>.*<\/li>\n?)+/gs, '<ul class="md-ul">$&</ul>');
    // Ordered lists
    out = out.replace(/^\d+\. (.+)$/gm, '<li class="md-li">$1</li>');
    // Line breaks
    out = out.replace(/\n\n/g, '</p><p class="md-p">');
    out = out.replace(/\n/g, '<br>');
    out = `<p class="md-p">${out}</p>`;

    // Restore code blocks
    codeBlocks.forEach((block, idx) => {
      out = out.replace(`\x00CODE${idx}\x00`, block);
    });

    return out;
  }

  function handleContainerClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest('button.copy-btn') as HTMLButtonElement | null;
    if (btn) {
      const code = decodeURIComponent(btn.dataset.code ?? '');
      copyText(code);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }
  }

  function openSettings() {
    showSettings = true;
  }

  $: messages = $currentConversation?.messages ?? [];
  $: configured = $isConfigured;
  $: isStreaming = messages.some(m => m.isStreaming);

  $: {
    if (extensionManager) {
      if (configured && $aiSettings) {
        extensionManager.setActiveViewStatusMessage(`${$aiSettings.provider} · ${$aiSettings.model}`);
      } else {
        extensionManager.setActiveViewStatusMessage(null);
      }
    }
  }

  onDestroy(() => {
    if (extensionManager) {
      extensionManager.setActiveViewStatusMessage(null);
    }
  });
</script>

{#if showSettings}
  <SettingsView on:close={() => { showSettings = false; }} />
{:else}
  <div class="chat-view">
    <div class="chat-main">
      <div class="messages-container" bind:this={messagesEl} on:scroll={handleScroll} role="log">
        {#if !configured}
          <div class="empty-state">
            <div class="empty-icon">🤖</div>
            <div class="empty-title">AI Chat</div>
            <p class="empty-hint">Configure your API provider in settings to start chatting.</p>
            <button class="setup-btn" on:click={openSettings}>Set up Provider</button>
          </div>
        {:else if messages.length === 0}
          <div class="empty-state">
            <div class="empty-icon">✨</div>
            <div class="empty-title">How can I help you today?</div>
            <p class="empty-hint">Type your message in the search bar above to start a conversation.</p>
          </div>
        {:else}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="messages-list" on:click={handleContainerClick}>
            {#each messages as message (message.id)}
              <div class="message-row {message.role}" class:streaming={message.isStreaming}>
                {#if message.role === 'assistant'}
                  <div class="avatar assistant-avatar">AI</div>
                {/if}
                <div class="message-bubble {message.role}">
                  {#if message.role === 'assistant'}
                    {@html renderMarkdown(message.content)}
                    {#if message.isStreaming}
                      <span class="streaming-cursor">▊</span>
                    {/if}
                  {:else}
                    <span class="user-text">{message.content}</span>
                  {/if}
                  <button class="copy-message-btn" on:click={() => copyText(message.content)} title="Copy message" tabindex="-1">
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
{/if}

<style>
  .chat-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--system-font, system-ui);
  }

  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-primary);
  }

  /* Messages Area */
  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .messages-container::-webkit-scrollbar { width: 6px; }
  .messages-container::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 4px; }

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
    font-size: 11px;
    font-weight: 700;
    margin-top: 2px;
  }
  .assistant-avatar { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
  .user-avatar { background: var(--accent-primary); color: white; }

  .message-bubble {
    position: relative;
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 13.5px;
    line-height: 1.55;
    word-break: break-word;
  }
  .message-bubble.assistant {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-top-left-radius: 4px;
  }
  .message-bubble.user {
    background: var(--accent-primary);
    color: white;
    border-top-right-radius: 4px;
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

  /* Empty State */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 20px;
    color: var(--text-tertiary);
  }
  .empty-icon { font-size: 42px; margin-bottom: 16px; opacity: 0.5; }
  .empty-title { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
  .empty-hint { font-size: 13px; margin-bottom: 20px; max-width: 300px; line-height: 1.4; }
  .setup-btn {
    font-size: 13px;
    padding: 6px 16px;
    border-radius: 8px;
    background: var(--accent-primary);
    color: white;
    border: none;
    cursor: pointer;
    font-weight: 600;
  }

  /* Markdown styles */
  :global(.md-p) { margin: 0 0 10px 0; }
  :global(.md-p:last-child) { margin-bottom: 0; }
  :global(.inline-code) {
    font-family: 'SF Mono', monospace;
    font-size: 0.9em;
    background: rgba(0,0,0,0.05);
    padding: 2px 4px;
    border-radius: 4px;
  }
  :global(.code-block) {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    margin: 12px 0;
    overflow: hidden;
  }
  :global(.code-header) {
    display: flex;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
  }
  :global(.copy-btn) {
    font-size: 11px;
    color: var(--text-secondary);
    background: none;
    border: 1px solid var(--border-color);
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  :global(.code-block pre) { margin: 0; padding: 12px; overflow-x: auto; }

  .streaming-cursor {
    display: inline-block;
    color: var(--accent-primary);
    font-weight: bold;
    animation: blink 0.8s step-end infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--accent-primary);
    font-weight: 500;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { transform: scale(0.8); opacity: 0.5; } 50% { transform: scale(1.2); opacity: 1; } }
</style>
