<script lang="ts">
  import { openerService } from '../../services/opener/openerService';
  import { externalSearchUrl } from '../../components/ai/googleSearchSuggestions';
  import { onMount, onDestroy, tick, untrack } from 'svelte';
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
    agentSwitcherOptions,
    chatSubtitle,
    threadRunTarget,
  } from './agentChatView.helpers';
  import {
    Button,
    EmptyState,
    IconButton,
    Icon,
    LauncherListRow,
    SplitListDetail,
    GoogleSearchSuggestions,
  } from '../../components';
  import ModelPickerModal from './ModelPickerModal.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { providerRegistry } from '../../services/ai/providerRegistry';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import type { ThreadDef, MessageDef } from './types';
  import { showSettingsWindow } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { t } from '../../services/i18n';
  import { isAnyModalOpen } from '../../components/base/Modal.logic';

  // The ⌘P agent switcher is owned by the Ask AI command's view.
  const ACCESSORY_EXTENSION_ID = 'agents';
  const ACCESSORY_COMMAND_ID = 'ask';

  const agentId = $derived(agentsManager.currentAgentId);
  // Live from the service, so a provider switch (⌘K) shows up immediately.
  const agent = $derived(agentId ? (agentService.getById(agentId) ?? null) : null);
  let threads = $state<ThreadDef[]>([]);
  // False until this agent's thread list is known, so the sidebar shows
  // nothing rather than an empty state that is not true yet.
  let threadsKnown = $state(false);
  let messages = $state<MessageDef[]>([]);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let userScrolledUp = $state(false);
  let loadError = $state<string | null>(null);

  const selectedThreadId = $derived(agentsManager.currentThreadId);
  const selectedThreadIndex = $derived(
    selectedThreadId ? threads.findIndex((t) => t.id === selectedThreadId) : -1,
  );
  const sending = $derived(agentsManager.sending);
  const streamingText = $derived(agentsManager.streamingText);
  const streamingStatus = $derived(agentsManager.streamingStatus);

  const agentOptions = $derived(agentSwitcherOptions(agentService.agents));

  // ⌘P switches agent. Threads belong to an agent, so this filters the
  // sidebar the way ⌘P filters Clipboard History. The current agent seeds the
  // dropdown (not its persisted value), so opening a specific agent from root
  // search is never overridden. Leaving the view clears it
  // (ExtensionViewContainer owns that for the `ask` command).
  $effect(() => {
    const options = agentOptions;
    const current = agentId;
    if (!current || options.length < 2 || !options.some((o) => o.value === current)) {
      const active = untrack(() => searchBarAccessoryService.active);
      if (active?.extensionId === ACCESSORY_EXTENSION_ID) searchBarAccessoryService.clear();
      return;
    }
    void searchBarAccessoryService.declare({
      extensionId: ACCESSORY_EXTENSION_ID,
      commandId: ACCESSORY_COMMAND_ID,
      options,
      value: current,
    });
  });

  $effect(() =>
    untrack(() =>
      searchBarAccessoryService.subscribe(ACCESSORY_EXTENSION_ID, ACCESSORY_COMMAND_ID, (value) => {
        if (value !== agentsManager.currentAgentId) void switchAgent(value);
      }),
    ),
  );

  /** Show another agent's threads, landing on its latest one like root search does. */
  async function switchAgent(nextAgentId: string) {
    agentsManager.currentAgentId = nextAgentId;
    agentsManager.currentThreadId = agentsManager.threadsFor(nextAgentId)?.[0]?.id ?? null;
    try {
      const latest = (await agentService.listThreads(nextAgentId))[0];
      if (agentsManager.currentAgentId === nextAgentId && !agentsManager.currentThreadId) {
        agentsManager.currentThreadId = latest?.id ?? null;
      }
    } catch (err) {
      logService.warn(`[agents] listThreads for agent switch failed: ${err}`);
    }
  }

  const selectedThread = $derived(threads.find((th) => th.id === selectedThreadId) ?? null);

  // Bottom-bar subtitle: who you are talking to, and the provider and model
  // this thread runs on (its own override, else its agent's).
  $effect(() => {
    if (!agent) return;
    const subtitle = sending
      ? `${agent.name} · ${t('features.agents.streaming_cancel')}`
      : chatSubtitle(
          { ...agent, ...threadRunTarget(agent, selectedThread) },
          settingsService.currentSettings.ai.providers,
          providerRegistry.list(),
        );
    viewManager.activeViewSubtitle = subtitle;
    return () => {
      // Only clear our own text; the next view may already have set its own.
      if (viewManager.activeViewSubtitle === subtitle) viewManager.activeViewSubtitle = null;
    };
  });

  function threadLabel(thread: ThreadDef): string {
    const title = thread.title?.trim();
    if (title) return title;
    if (thread.createdAt) return new Date(thread.createdAt).toLocaleString();
    return 'New thread';
  }

  // Ignore loads superseded by an agent, thread, or send-state change.
  $effect(() => {
    const currentAgentId = agentId;
    const currentThreadId = agentsManager.currentThreadId;
    void agentsManager.sending;
    void agentsManager.threadsVersion;
    void agentsManager.messagesVersion;
    let cancelled = false;

    void (async () => {
      if (!currentAgentId) {
        threads = [];
        messages = [];
        agentsManager.lastAssistantMessageText = null;
        return;
      }

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
          // The saved turn now renders; drop its streamed copy. A turn still
          // streaming is left alone so it never blinks out mid-reply.
          if (agentsManager.streamingTextPersisted) {
            agentsManager.streamingText = '';
            agentsManager.streamingTextPersisted = false;
          }
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
    // The ⌘P agent dropdown owns arrows while it is open.
    if (searchBarAccessoryService.popoverOpen) return;
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
    <SplitListDetail
      items={threads}
      selectedIndex={selectedThreadIndex}
      leftWidth={240}
      minLeftWidth={180}
      maxLeftWidth={420}
      isLoading={!threadsKnown}
      emptyMessage={t('features.agents.no_threads')}
      ariaLabel="Threads"
    >
      {#snippet listItem(thread, index)}
        <LauncherListRow
          data-index={index}
          selected={selectedThreadId === thread.id}
          title={threadLabel(thread)}
          onclick={() => void onSelectThread(thread.id)}
        >
          {#snippet trailing()}
            {#if thread.isPinned}
              <span
                class="pin-badge flex items-center justify-center opacity-70"
                aria-label={t('features.agents.act.pin_thread')}
                data-testid="thread-pin-icon"
              >
                <Icon name="pin" size={13} />
              </span>
            {/if}
          {/snippet}
        </LauncherListRow>
      {/snippet}

      {#snippet detail()}
        <div class="chat-main">
          <div
            class="messages-container custom-scrollbar"
            data-no-focus-steal
            bind:this={messagesEl}
            onscroll={handleScroll}
            role="log"
          >
            {#if loadError}
              <p class="error">{loadError}</p>
            {:else if messages.length === 0 && !sending && streamingText.length === 0}
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

                <!-- Stays after the run ends until the reload renders the
                     persisted turn (which clears streamingText), so the reply
                     never blinks out in between. -->
                {#if sending || streamingText.length > 0}
                  <div class="message-row assistant">
                    <div class="message-bubble assistant">
                      {#if streamingText.length > 0}
                        <div class="md-content">{@html renderMarkdown(streamingText)}</div>
                      {:else if streamingStatus === 'searching'}
                        <span class="activity-label">{t('features.agents.searching')}</span>
                      {/if}
                      {#if sending}
                        <span class="streaming-cursor">▊</span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/snippet}
    </SplitListDetail>
    <ModelPickerModal />
  {/if}
</div>

<style>
  .agent-chat-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }
  .empty-state-wrapper {
    flex: 1;
    display: flex;
  }
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .pin-badge {
    color: var(--accent-primary);
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
  .message-bubble.assistant {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-bottom-left-radius: var(--radius-xs);
  }
  /* Tool turns are just collapsed chips, no bubble. */
  .message-bubble.tool {
    flex: 1;
    max-width: none;
    padding: 0;
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
