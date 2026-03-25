<script lang="ts">
  import { onMount, onDestroy, tick, afterUpdate } from 'svelte';
  import {
    aiSettings, currentConversation, isConfigured, conversationHistory,
    addUserMessage, beginAssistantMessage, appendStreamToken,
    finalizeAssistantMessage, failAssistantMessage, clearConversation,
    loadConversation, deleteConversation,
    type AIMessage, type AIConversation,
  } from './aiStore';
  import { streamChat, stopStream } from './aiService';
  import SettingsView from './SettingsView.svelte';

  // extensionManager is required by the extension view contract
  export let extensionManager: any = undefined;

  let inputValue = '';
  let isStreaming = false;
  let showSettings = false;
  let messagesEl: HTMLDivElement;
  let inputEl: HTMLTextAreaElement;
  let userScrolledUp = false;

  const unsubConv = currentConversation.subscribe(() => {
    if (!userScrolledUp) scrollToBottom();
  });
  onDestroy(() => unsubConv());

  // When the view opens with an initial query (from "Ask AI" result)
  export let initialQuery: string | undefined = undefined;
  onMount(async () => {
    await tick();
    inputEl?.focus();
    if (initialQuery) {
      inputValue = initialQuery;
      initialQuery = undefined;
      await sendMessage();
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

  async function sendMessage() {
    const content = inputValue.trim();
    if (!content || isStreaming) return;
    inputValue = '';
    userScrolledUp = false;

    addUserMessage(content);
    await tick();
    scrollToBottom();

    const settings = $aiSettings;
    if (!$isConfigured) return;

    isStreaming = true;
    const msgId = beginAssistantMessage();
    await tick();
    scrollToBottom();

    const conv = $currentConversation!;
    const msgs = conv.messages.filter(m => !m.isStreaming);

    await streamChat(msgs, settings, {
      onToken: (token) => {
        appendStreamToken(msgId, token);
      },
      onDone: () => {
        finalizeAssistantMessage(msgId);
        isStreaming = false;
        tick().then(() => { inputEl?.focus(); scrollToBottom(); });
      },
      onError: (error) => {
        failAssistantMessage(msgId, `⚠️ ${error}`);
        isStreaming = false;
        tick().then(() => inputEl?.focus());
      },
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleStop() {
    stopStream();
    isStreaming = false;
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
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

  /** Minimal Markdown → HTML renderer (bold, italic, code, code blocks) */
  function renderMarkdown(text: string): string {
    let out = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks — capture and replace with placeholder, process after
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

  $: messages = $currentConversation?.messages ?? [];
  $: configured = $isConfigured;
</script>

{#if showSettings}
  <SettingsView on:close={() => { showSettings = false; tick().then(() => inputEl?.focus()); }} />
{:else}
  <div class="chat-view">
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-title">
        <span class="chat-icon">🤖</span>
        <span>AI Chat</span>
        {#if $currentConversation?.title}
          <span class="chat-subtitle" title={$currentConversation.title}>— {$currentConversation.title}</span>
        {/if}
      </div>
      <div class="header-actions">
        <button class="icon-action" on:click={clearConversation} title="New Chat" disabled={isStreaming}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <span>New</span>
        </button>
        <button class="icon-action" on:click={() => showSettings = true} title="AI Settings">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          <span>Settings</span>
        </button>
      </div>
    </div>

    <div class="chat-container">
      <div class="chat-main">
        <!-- Not configured warning -->
        {#if !configured}
          <div class="not-configured">
            <span>⚙️ Configure your AI provider to start chatting.</span>
            <button class="setup-btn" on:click={() => showSettings = true}>Set up now</button>
          </div>
        {/if}

        <!-- Messages area -->
        <div class="messages-area" bind:this={messagesEl} on:scroll={handleScroll} role="log" aria-label="Conversation">
          {#if messages.length === 0}
            <div class="empty-state">
              <div class="empty-icon">🤖</div>
              <div class="empty-title">Ask me anything</div>
              <div class="empty-hint">Type a question below — or try one of these:</div>
              <div class="suggestions">
                {#each ['Explain how LLMs work in simple terms', 'Write a Python script to rename files', 'What is the difference between TCP and UDP?'] as suggestion}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <!-- svelte-ignore a11y-interactive-supports-focus -->
                  <div class="suggestion-chip" role="button" on:click={() => { inputValue = suggestion; inputEl?.focus(); }}>
                    {suggestion}
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="messages" on:click={handleContainerClick} role="presentation">
              {#each messages as message (message.id)}
                <div class="message-row {message.role}">
                  {#if message.role === 'assistant'}
                    <div class="avatar">🤖</div>
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

        <!-- Input area -->
        <div class="input-area">
          <!-- svelte-ignore a11y-label-has-associated-control -->
          <div class="input-box" class:disabled={!configured}>
            <textarea
              bind:this={inputEl}
              bind:value={inputValue}
              placeholder={configured ? 'Ask a question… (Shift+Enter for new line)' : 'Set up your AI provider first'}
              disabled={!configured || isStreaming}
              rows="1"
              class="chat-input"
              on:keydown={handleKeydown}
              on:input={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 120) + 'px';
              }}
            ></textarea>
            {#if isStreaming}
              <button class="send-btn stop" on:click={handleStop} title="Stop generation">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              </button>
            {:else}
              <button class="send-btn" on:click={sendMessage} disabled={!configured || !inputValue.trim()} title="Send (Enter)">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            {/if}
          </div>
          <div class="input-footer">
            <span class="provider-badge">{$aiSettings.provider} · {$aiSettings.model}</span>
            {#if isStreaming}
              <span class="streaming-indicator">
                <span class="dot"></span> Generating…
              </span>
            {/if}
          </div>
        </div>
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

  /* Header */
  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    background: var(--bg-secondary);
  }
  .chat-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
  }
  .chat-icon { font-size: 16px; }
  .chat-subtitle {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-tertiary);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .header-actions { display: flex; gap: 4px; }
  .icon-action {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 1px solid transparent;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 5px;
    font-size: 12px;
    transition: all 0.12s;
  }
  .icon-action:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-color);
  }
  .icon-action:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Not configured banner */
  .not-configured {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: rgba(255, 149, 0, 0.08);
    border-bottom: 1px solid rgba(255, 149, 0, 0.2);
    font-size: 12px;
    color: var(--accent-warning, #f90);
    flex-shrink: 0;
  }
  .setup-btn {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 5px;
    background: var(--accent-warning, #f90);
    color: white;
    border: none;
    cursor: pointer;
    font-weight: 500;
  }

  /* Messages */
  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: 12px 0;
    min-height: 0;
    scroll-behavior: smooth;
  }
  .messages-area::-webkit-scrollbar { width: 6px; }
  .messages-area::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 4px; }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    color: var(--text-tertiary);
  }
  .empty-icon { font-size: 36px; margin-bottom: 10px; }
  .empty-title { font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
  .empty-hint { font-size: 12px; margin-bottom: 14px; }
  .suggestions { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 420px; }
  .suggestion-chip {
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s;
    text-align: left;
  }
  .suggestion-chip:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--accent-primary); }

  /* Message rows */
  .messages { display: flex; flex-direction: column; gap: 8px; padding: 4px 14px; }
  .message-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .message-row.user { flex-direction: row-reverse; }
  .avatar {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    background: var(--bg-tertiary);
    margin-top: 2px;
  }
  .user-avatar {
    background: var(--accent-primary);
    color: white;
    font-size: 10px;
    font-weight: 700;
  }

  .message-bubble {
    position: relative;
    max-width: 80%;
    padding: 9px 12px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;
  }
  .message-bubble.assistant {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-bottom-left-radius: 4px;
  }
  .message-bubble.user {
    background: var(--accent-primary);
    color: white;
    border-bottom-right-radius: 4px;
    text-align: left;
  }
  .user-text { white-space: pre-wrap; }

  /* Copy message button */
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
    border-radius: 3px;
  }
  .message-bubble:hover .copy-message-btn { opacity: 1; }
  .copy-message-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
  .message-bubble.user .copy-message-btn { color: rgba(255,255,255,0.6); }
  .message-bubble.user .copy-message-btn:hover { color: white; background: rgba(255,255,255,0.15); }

  /* Streaming cursor */
  .streaming-cursor {
    display: inline-block;
    animation: blink 0.8s step-end infinite;
    color: var(--accent-primary);
    margin-left: 1px;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  /* Markdown styles */
  :global(.md-p) { margin: 0 0 8px 0; }
  :global(.md-p:last-child) { margin-bottom: 0; }
  :global(.md-h1) { font-size: 16px; font-weight: 700; margin: 6px 0 4px; }
  :global(.md-h2) { font-size: 14px; font-weight: 700; margin: 6px 0 4px; }
  :global(.md-h3) { font-size: 13px; font-weight: 600; margin: 4px 0 3px; }
  :global(.md-ul) { margin: 4px 0; padding-left: 16px; list-style: disc; }
  :global(.md-li) { margin: 2px 0; }
  :global(.inline-code) {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    background: var(--bg-tertiary);
    padding: 1px 4px;
    border-radius: 3px;
  }
  :global(.code-block) {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin: 6px 0;
    overflow: hidden;
  }
  :global(.code-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
  }
  :global(.code-lang) {
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: 'SF Mono', monospace;
    text-transform: uppercase;
  }
  :global(.copy-btn) {
    font-size: 11px;
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: pointer;
    padding: 1px 7px;
    border-radius: 4px;
    transition: all 0.12s;
  }
  :global(.copy-btn:hover) { background: var(--bg-hover); color: var(--text-primary); }
  :global(.code-block pre) { margin: 0; padding: 10px 12px; overflow-x: auto; }
  :global(.code-block code) {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    color: var(--text-primary);
  }

  /* Input area */
  .input-area {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px 10px;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
    background: var(--bg-secondary);
  }
  .input-box {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 6px 8px 6px 12px;
    transition: border-color 0.12s;
  }
  .input-box:focus-within { border-color: var(--accent-primary); }
  .input-box.disabled { opacity: 0.55; }
  .chat-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    height: 22px;
    max-height: 120px;
    overflow-y: auto;
    font-family: var(--system-font, system-ui);
  }
  .chat-input::placeholder { color: var(--text-tertiary); }
  .send-btn {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: none;
    background: var(--accent-primary);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s;
  }
  .send-btn:hover { filter: brightness(1.1); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .send-btn.stop { background: var(--accent-danger, #ff3b30); }

  .input-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px;
  }
  .provider-badge {
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: 'SF Mono', monospace;
  }
  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--accent-primary);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-primary);
  }
</style>
