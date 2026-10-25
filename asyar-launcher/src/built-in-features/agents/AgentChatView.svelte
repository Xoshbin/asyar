<script lang="ts">
  import { openerService } from '../../services/opener/openerService';
  import { externalSearchUrl } from '../../components/ai/googleSearchSuggestions';
  import { onMount, onDestroy, tick } from 'svelte';
  import { agentService } from './agentService.svelte';
  import { agentsManager } from './agentsManager.svelte';
  import { renderMarkdown, handleMarkdownCopyClick } from '../../utils/markdown';
  import { copyText } from '../../utils/copyText';
  import { logService } from '../../services/log/logService';
  import {
    extractTextFromMessage,
    extractGroundingFromMessage,
    extractSourcesFromMessage,
    extractToolUsesFromMessage,
    messageBubbleVariant,
    resolveThreadId,
    lastAssistantMessageText,
    assistantProviderOptions,
  } from './agentChatView.helpers';
  import EmptyState from '../../components/feedback/EmptyState.svelte';
  import { Button, IconButton, GoogleSearchSuggestions, Select } from '../../components';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { providerRegistry } from '../../services/ai/providerRegistry';
  import ThreadListSidebar from './ThreadListSidebar.svelte';
  import type { AgentDef, ThreadDef, MessageDef } from './types';
  import { showSettingsWindow } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { t } from '../../services/i18n';
  import { isAnyModalOpen } from '../../components/base/Modal.logic';

  const agentId = $derived(agentsManager.currentAgentId);
  let agent = $state<AgentDef | null>(null);
  let threads = $state<ThreadDef[]>([]);
  // False until this agent's thread list is known, so the sidebar shows
  // nothing rather than an empty state that is not true yet.
  let threadsKnown = $state(false);
  let messages = $state<MessageDef[]>([]);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let userScrolledUp = $state(false);
  let loadError = $state<string | null>(null);

  const selectedThreadId = $derived(agentsManager.currentThreadId);
  const sending = $derived(agentsManager.sending);
  const streamingText = $derived(agentsManager.streamingText);
  const streamingStatus = $derived(agentsManager.streamingStatus);

  // The Assistant (default agent) follows the starred provider; let the user
  // switch it right from the chat header.
  const isAssistant = $derived(agent !== null && agent.id === agentService.defaultAgent?.id);
  const providerOptions = $derived(
    assistantProviderOptions(settingsService.currentSettings.ai.providers, providerRegistry.list()),
  );

  async function switchProvider(providerId: string) {
    const modelId = settingsService.currentSettings.ai.providers[providerId]?.lastModelId;
    if (!modelId) return;
    try {
      await agentService.upsertDefaultAgent(providerId, modelId);
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: t('settings.ai.error_set_default') },
        developerDetail: String(err),
      });
    }
  }

  // Ignore loads superseded by an agent, thread, or send-state change.
  $effect(() => {
    const currentAgentId = agentId;
    const currentThreadId = agentsManager.currentThreadId;
    void agentsManager.sending;
    void agentsManager.messagesVersion;
    let cancelled = false;

    void (async () => {
      if (!currentAgentId) {
        agent = null;
        threads = [];
        messages = [];
        agentsManager.lastAssistantMessageText = null;
        return;
      }

      agent = agentService.getById(currentAgentId) ?? null;
      loadError = null;
      const known = agentsManager.threadsFor(currentAgentId);
      threads = known ?? [];
      threadsKnown = known !== undefined;

      let nextThreads: ThreadDef[];
      try {
        nextThreads = await agentService.listThreads(currentAgentId);
      } catch (err) {
        if (cancelled) return;
        loadError = err instanceof Error ? err.message : String(err);
        return;
      }

      if (cancelled) return;
      threads = nextThreads;
      threadsKnown = true;
      agentsManager.rememberThreads(currentAgentId, nextThreads);

      const resolvedThreadId = resolveThreadId(currentThreadId, nextThreads);
      if (resolvedThreadId !== currentThreadId) {
        agentsManager.currentThreadId = resolvedThreadId;
        messages = [];
        agentsManager.lastAssistantMessageText = null;
        return;
      }

      if (!resolvedThreadId) {
        messages = [];
        agentsManager.lastAssistantMessageText = null;
        return;
      }

      try {
        const nextMessages = await agentService.listMessages(resolvedThreadId);
        if (!cancelled) {
          messages = nextMessages;
          // The persisted turn now renders; drop its streamed copy. A turn
          // still streaming restores itself on the next delta (accumulated).
          agentsManager.streamingText = '';
          agentsManager.lastAssistantMessageText = lastAssistantMessageText(nextMessages);
        }
      } catch (err) {
        if (cancelled) return;
        logService.warn(`[agents] listMessages failed: ${err}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    // Scroll-to-bottom when messages or streaming buffer changes.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    messages.length;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    streamingText;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    streamingStatus;
    if (!userScrolledUp) scrollToBottom();
  });

  function scrollToBottom() {
    const element = messagesEl;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }

  function handleScroll() {
    if (!messagesEl) return;
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
    userScrolledUp = !atBottom;
  }

  function openSearchSource(value: string) {
    const url = externalSearchUrl(value);
    if (url)
      void openerService
        .open(null, url)
        .catch((error) => logService.warn(`[agents] Cannot open source: ${error}`));
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
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // When the action panel (Cmd+K) is open, let it own keyboard navigation.
    if (document.querySelector('.action-popup')) return;
    // A modal dialog can open on top of this view — don't steal its keys.
    if (isAnyModalOpen(document)) return;
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

  async function handleSetUpAi() {
    try {
      await showSettingsWindow('ai');
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: t('features.agents.error_open_ai_settings') },
        developerDetail: String(err),
      });
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
    <div class="empty-state-wrapper">
      <EmptyState
        message={t('features.agents.setup_ai')}
        description={t('features.agents.setup_ai_description')}
      >
        {#snippet icon()}
          <span class="text-4xl">🤖</span>
        {/snippet}
        <Button onclick={handleSetUpAi}>{t('features.agents.setup_ai_button')}</Button>
      </EmptyState>
    </div>
  {:else if !agent}
    <div class="empty-state-wrapper">
      <EmptyState message={t('features.agents.loading_agent')} />
    </div>
  {:else}
    <div class="chat-layout">
      <ThreadListSidebar {threads} known={threadsKnown} {selectedThreadId} {onSelectThread} />
      <div class="chat-main">
        <header class="chat-header">
          <h2>{agent.name}</h2>
          {#if isAssistant && providerOptions.length > 0}
            <div class="provider-picker">
              <Select
                value={agent.providerId}
                options={providerOptions}
                disabled={sending}
                onchange={switchProvider}
              />
            </div>
          {/if}
          {#if sending}
            <span class="streaming-tag">{t('features.agents.streaming_cancel')}</span>
          {/if}
        </header>

        <div
          class="messages-container custom-scrollbar"
          data-no-focus-steal
          bind:this={messagesEl}
          onscroll={handleScroll}
          role="log"
        >
          {#if loadError}
            <p class="error">{loadError}</p>
          {:else if messages.length === 0 && !sending}
            <EmptyState
              message={t('features.agents.start_chatting')}
              description={t('features.agents.start_chatting_description')}
            />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="messages-list" onclick={handleMarkdownCopyClick}>
              {#each messages as message (message.id)}
                {@const variant = messageBubbleVariant(message)}
                {@const text = extractTextFromMessage(message)}
                {@const grounding = extractGroundingFromMessage(message)}
                {@const sources = extractSourcesFromMessage(message, messages)}
                {@const toolUses = extractToolUsesFromMessage(message)}
                <div class="message-row {variant}">
                  <div class="message-bubble {variant}">
                    {#if variant === 'assistant'}
                      {#if text.length > 0}
                        <div class="md-content">{@html renderMarkdown(text)}</div>
                      {/if}
                      {#if sources.length > 0}
                        <div class="grounding-sources">
                          <span class="text-caption">{t('features.agents.sources')}</span>
                          {#each sources as source, index}
                            <a
                              href={source.url}
                              onclick={(event) => {
                                event.preventDefault();
                                openSearchSource(source.url);
                              }}>{index + 1}. {source.title}</a
                            >
                          {/each}
                        </div>
                      {/if}
                      {#each grounding as search}
                        {#if search.searchSuggestionsHtml}
                          <GoogleSearchSuggestions
                            html={search.searchSuggestionsHtml}
                            onOpen={openSearchSource}
                          />
                        {/if}
                      {/each}
                      {#each toolUses as tu (tu.id)}
                        <details class="tool-use-chip">
                          <summary class="chip-name">⚙ {tu.name}</summary>
                          <pre class="chip-input">{JSON.stringify(tu.input, null, 2)}</pre>
                        </details>
                      {/each}
                    {:else if variant === 'tool'}
                      {#if sources.length > 0}
                        <div class="grounding-sources">
                          <span class="text-caption">{t('features.agents.sources')}</span>
                          {#each sources as source, index}
                            <a
                              href={source.url}
                              onclick={(event) => {
                                event.preventDefault();
                                openSearchSource(source.url);
                              }}>{index + 1}. {source.title}</a
                            >
                          {/each}
                        </div>
                      {/if}
                      <details class="tool-use-chip">
                        <summary class="chip-name">{t('features.agents.tool_result')}</summary>
                        <pre class="tool-result">{text}</pre>
                      </details>
                    {:else}
                      <span class="user-text">{text}</span>
                    {/if}
                    <IconButton
                      class="copy-message-btn"
                      onclick={() => copyText(text)}
                      title={t('features.agents.copy_message')}
                      ariaLabel={t('features.agents.copy_message')}
                      size="sm"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        ><rect x="9" y="9" width="13" height="13" rx="2" /><path
                          d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                        /></svg
                      >
                    </IconButton>
                  </div>
                </div>
              {/each}

              {#if sending}
                <div class="message-row assistant">
                  <div class="message-bubble assistant">
                    {#if streamingText.length > 0}
                      <div class="md-content">{@html renderMarkdown(streamingText)}</div>
                    {:else if streamingStatus === 'searching'}
                      <span class="activity-label">{t('features.agents.searching')}</span>
                    {/if}
                    <span class="streaming-cursor">▊</span>
                  </div>
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
  .empty-state-wrapper {
    flex: 1;
    display: flex;
  }
  .chat-layout {
    display: flex;
    width: 100%;
    gap: var(--space-0-5);
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
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-color);
  }
  .chat-header h2 {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .provider-picker {
    margin-left: auto;
    margin-right: var(--space-3);
    max-width: 12rem;
  }
  .streaming-tag {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }
  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6) 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .messages-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: 0 var(--space-6);
  }
  .message-row {
    display: flex;
  }
  .message-row.user {
    justify-content: flex-end;
  }

  .message-bubble {
    position: relative;
    min-width: 0;
    max-width: 85%;
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-xl);
    font-size: var(--font-size-base);
    line-height: 1.55;
    word-break: break-word;
  }
  /* Replies read as a document, full width; only the user's turns are bubbles. */
  .message-bubble.assistant,
  .message-bubble.tool {
    flex: 1;
    max-width: none;
    padding: 0;
    color: var(--text-primary);
  }
  .message-bubble.user {
    background: var(--accent-primary-fill);
    color: var(--text-on-accent);
    border-bottom-right-radius: var(--radius-xs);
  }
  .message-bubble.tool {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  :global(.copy-message-btn) {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    opacity: 0;
  }
  .message-bubble:hover :global(.copy-message-btn),
  .message-bubble:focus-within :global(.copy-message-btn) {
    opacity: 1;
  }
  .message-bubble.user :global(.copy-message-btn) {
    color: inherit;
    opacity: 0;
  }
  .message-bubble.user:hover :global(.copy-message-btn),
  .message-bubble.user:focus-within :global(.copy-message-btn) {
    opacity: 0.7;
  }

  .md-content,
  .user-text,
  .tool-result,
  .chip-input {
    -webkit-user-select: text;
    user-select: text;
  }

  .grounding-sources {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-3);
    font-size: var(--font-size-sm);
  }
  .grounding-sources a {
    color: var(--accent-primary);
  }

  .tool-use-chip {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
  }
  .chip-name {
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .chip-input,
  .tool-result {
    margin: var(--space-1) 0 0;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .streaming-cursor {
    display: inline-block;
    color: var(--accent-primary);
    font-weight: bold;
    animation: blink 0.8s step-end infinite;
  }
  .activity-label {
    color: var(--text-tertiary);
    font-style: italic;
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  .error {
    color: var(--accent-danger);
    padding: var(--space-6);
    margin: 0;
  }
</style>
