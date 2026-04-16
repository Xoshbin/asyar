<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { aiStore } from './aiStore.svelte';
  import { stopStream } from '../../services/ai/aiEngine';
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

  /** Minimal Markdown → HTML renderer (bold, italic, code, code blocks) */
  function renderMarkdown(text: string): string {
    let out = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const codeBlocks: string[] = [];
    out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.length;
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      codeBlocks.push(
        `<div class="code-block"><div class="code-header">${langLabel}<button class="copy-btn" data-code="${encodeURIComponent(code.trimEnd())}">Copy</button></div><pre><code>${code.trimEnd()}</code></pre></div>`
      );
      return `\x00CODE${idx}\x00`;
    });

    out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
    out = out.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    out = out.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    out = out.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
    out = out.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>');
    out = out.replace(/(<li[^>]*>.*<\/li>\n?)+/gs, '<ul class="md-ul">$&</ul>');
    out = out.replace(/^\d+\. (.+)$/gm, '<li class="md-li">$1</li>');
    out = out.replace(/\n\n/g, '</p><p class="md-p">');
    out = out.replace(/\n/g, '<br>');
    out = `<p class="md-p">${out}</p>`;

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
        <div class="messages-list" onclick={handleContainerClick}>
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

  :global(.md-p) { margin: 0 0 10px 0; }
  :global(.md-p:last-child) { margin-bottom: 0; }
  :global(.inline-code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--bg-hover);
    padding: 2px 4px;
    border-radius: var(--radius-xs);
  }
  :global(.code-block) {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
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
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    background: none;
    border: 1px solid var(--border-color);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
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
</style>
