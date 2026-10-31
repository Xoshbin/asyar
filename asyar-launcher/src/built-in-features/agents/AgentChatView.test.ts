// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentService.svelte', () => ({
  agentService: {
    agents: [],
    getById: vi.fn(),
    listThreads: vi.fn(),
    listMessages: vi.fn(),
  },
}));

vi.mock('../../components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    Button: (await import('../../components/base/Button.svelte')).default,
    IconButton: (await import('../../components/base/IconButton.svelte')).default,
    EmptyState: (await import('../../components/feedback/EmptyState.svelte')).default,
    SplitListDetail: (await import('../../components/layout/SplitListDetail.svelte')).default,
    LauncherListRow: (await import('../../components/list/LauncherListRow.svelte')).default,
    Icon: (await import('../../components/base/Icon.svelte')).default,
    WarningBanner: (await import('../../components/feedback/WarningBanner.svelte')).default,
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsBackfillThreadTitles: vi.fn(),
  replaceDynamicCommandsBuiltin: vi.fn(),
  showSettingsWindow: vi.fn(),
  aiListModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/copyText', () => ({ copyText: vi.fn() }));
import { copyText } from '../../utils/copyText';

import AgentChatView from './AgentChatView.svelte';
import { agentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';
import type { MessageDef } from './types';
import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

const mockedAgentService = vi.mocked(agentService);

const agent = {
  id: 'agent-1',
  name: 'Asyar Assistant',
  description: null,
  systemPrompt: '',
  providerId: 'provider-1',
  modelId: 'model-1',
  toolSelection: [],
  silent: false,
  inputSource: 'argument' as const,
  outputAction: 'replaceSelection' as const,
  cacheResponses: false,
  shortcodeTrigger: ':',
  createdAt: 1,
  updatedAt: 1,
};

const thread = {
  id: 'thread-1',
  agentId: agent.id,
  title: 'Thread to delete',
  createdAt: 1,
  updatedAt: 1,
};

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('AgentChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAgentService.getById.mockReturnValue(agent);
    mockedAgentService.listThreads.mockResolvedValue([thread]);
    mockedAgentService.listMessages.mockResolvedValue([]);
    agentsManager.currentAgentId = agent.id;
    agentsManager.currentThreadId = thread.id;
    agentsManager.sending = false;
    agentsManager.lastAssistantMessageText = null;
    agentsManager.threadsVersion = 0;
    agentsManager.streamingText = '';
    agentsManager.streamingTextPersisted = false;
    // jsdom has no scrollIntoView; the thread list calls it on re-render.
    Element.prototype.scrollIntoView = vi.fn();
    (mockedAgentService as any).agents = [];
    searchBarAccessoryService.clear();
    searchBarAccessoryService.popoverOpen = false;
    viewManager.activeViewSubtitle = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers keyboard-accessible whole-message copy and preserves native copy', async () => {
    const text = '**Answer**\n\n```ts\nconst n = 1;\n```';
    mockedAgentService.listMessages.mockResolvedValue([
      {
        id: 'answer',
        threadId: thread.id,
        role: 'assistant',
        content: { text },
        createdAt: 1,
        runId: null,
      },
    ]);
    render(AgentChatView);
    const button = await screen.findByRole('button', { name: 'Copy message' });
    expect(button.tabIndex).toBe(0);
    expect(button.closest('[data-no-focus-steal]')).not.toBeNull();
    await fireEvent.click(button);
    expect(copyText).toHaveBeenCalledWith(text);
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    const selectionEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(selectionEvent);
    expect(selectionEvent.defaultPrevented).toBe(false);
  });

  it('refreshes the sidebar when the selected thread is cleared after deletion', async () => {
    render(AgentChatView);
    await screen.findByText(thread.title);

    mockedAgentService.listThreads.mockResolvedValue([]);
    agentsManager.currentThreadId = null;

    await screen.findByText('No threads');
    await waitFor(() => expect(screen.queryByText(thread.title)).toBeNull());
  });

  it('refreshes the sidebar when threadsVersion is incremented', async () => {
    render(AgentChatView);
    await screen.findByText(thread.title);

    const updatedThread = { ...thread, isPinned: true };
    mockedAgentService.listThreads.mockResolvedValue([updatedThread]);
    agentsManager.threadsVersion++;

    await screen.findByTestId('thread-pin-icon');
  });

  it('does not claim there are no threads before the list has loaded', async () => {
    // An agent this suite has never loaded, so nothing is remembered for it.
    agentsManager.currentAgentId = 'agent-not-yet-loaded';
    const pending = deferred<(typeof thread)[]>();
    mockedAgentService.listThreads.mockReturnValue(pending.promise);

    render(AgentChatView);
    await waitFor(() => expect(mockedAgentService.listThreads).toHaveBeenCalled());
    expect(screen.queryByText('No threads')).toBeNull();

    pending.resolve([thread]);
    await screen.findByText(thread.title);
  });

  it('shows the last known threads at once when the view opens again', async () => {
    const first = render(AgentChatView);
    await screen.findByText(thread.title);
    first.unmount();

    mockedAgentService.listThreads.mockReturnValue(new Promise(() => {}));
    render(AgentChatView);

    expect(screen.getByText(thread.title)).toBeTruthy();
    expect(screen.queryByText('No threads')).toBeNull();
  });

  it('fetches the initial thread list only once', async () => {
    render(AgentChatView);

    await screen.findByText(thread.title);
    expect(mockedAgentService.listThreads.mock.calls).toHaveLength(1);
  });

  it('ignores messages that resolve after a newer thread is selected', async () => {
    const otherThread = { ...thread, id: 'thread-2', title: 'Current thread' };
    const staleMessages = deferred<MessageDef[]>();
    mockedAgentService.listThreads.mockResolvedValue([thread, otherThread]);
    mockedAgentService.listMessages.mockImplementation((threadId) => {
      if (threadId === thread.id) return staleMessages.promise;
      return Promise.resolve([
        {
          id: 'message-2',
          threadId: otherThread.id,
          role: 'user',
          content: { text: 'Current message' },
          createdAt: 2,
          runId: null,
        },
      ]);
    });

    render(AgentChatView);
    await waitFor(() =>
      expect(mockedAgentService.listMessages.mock.calls).toContainEqual([thread.id]),
    );

    agentsManager.currentThreadId = otherThread.id;
    await screen.findByText('Current message');

    staleMessages.resolve([
      {
        id: 'message-1',
        threadId: thread.id,
        role: 'user',
        content: { text: 'Stale message' },
        createdAt: 1,
        runId: null,
      },
    ]);

    await waitFor(() => expect(screen.queryByText('Stale message')).toBeNull());
    expect(screen.getByText('Current message')).toBeTruthy();
  });

  it('mirrors the latest assistant message onto agentsManager for copy-last-response', async () => {
    mockedAgentService.listMessages.mockResolvedValue([
      {
        id: 'm1',
        threadId: thread.id,
        role: 'user',
        content: { text: 'Hi' },
        createdAt: 1,
        runId: null,
      },
      {
        id: 'm2',
        threadId: thread.id,
        role: 'assistant',
        content: { text: 'Hello there' },
        createdAt: 2,
        runId: null,
      },
    ]);

    render(AgentChatView);
    await screen.findByText(thread.title);

    await waitFor(() => expect(agentsManager.lastAssistantMessageText).toBe('Hello there'));
  });

  it('clears the mirrored assistant text once the thread is cleared', async () => {
    mockedAgentService.listMessages.mockResolvedValue([
      {
        id: 'm2',
        threadId: thread.id,
        role: 'assistant',
        content: { text: 'Hello there' },
        createdAt: 2,
        runId: null,
      },
    ]);
    render(AgentChatView);
    await waitFor(() => expect(agentsManager.lastAssistantMessageText).toBe('Hello there'));

    mockedAgentService.listThreads.mockResolvedValue([]);
    agentsManager.currentThreadId = null;

    await waitFor(() => expect(agentsManager.lastAssistantMessageText).toBeNull());
  });

  it('keeps pending scroll callbacks safe after unmount', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
    );

    const view = render(AgentChatView);
    await screen.findByText(thread.title);
    view.unmount();

    expect(callbacks.length).toBeGreaterThan(0);
    expect(() => callbacks.forEach((callback) => callback(0))).not.toThrow();
  });

  it('switches thread when clicking a thread row in the list', async () => {
    const thread2 = {
      id: 'thread-2',
      agentId: agent.id,
      title: 'Second Thread',
      createdAt: 2,
      updatedAt: 2,
    };
    mockedAgentService.listThreads.mockResolvedValue([thread, thread2]);
    render(AgentChatView);

    const secondThread = await screen.findByText('Second Thread');
    await fireEvent.click(secondThread);
    expect(agentsManager.currentThreadId).toBe('thread-2');
  });

  it('keeps a streaming reply on screen when messages reload mid-stream', async () => {
    render(AgentChatView);
    await screen.findByText(thread.title);

    agentsManager.sending = true;
    agentsManager.streamingText = 'Half an answer';
    await screen.findByText('Half an answer');

    await waitFor(() => expect(mockedAgentService.listMessages).toHaveBeenCalled());
    const loadsBefore = mockedAgentService.listMessages.mock.calls.length;
    agentsManager.messagesVersion += 1; // e.g. the user message was saved
    await waitFor(() =>
      expect(mockedAgentService.listMessages.mock.calls.length).toBeGreaterThan(loadsBefore),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Half an answer')).toBeTruthy();
    expect(agentsManager.streamingText).toBe('Half an answer');
  });

  it('keeps the saved reply on screen after the run ends until the reload lands', async () => {
    const reload = deferred<MessageDef[]>();
    render(AgentChatView);
    await screen.findByText(thread.title);

    agentsManager.sending = true;
    agentsManager.streamingText = 'Streamed answer';
    await screen.findByText('Streamed answer');

    mockedAgentService.listMessages.mockReturnValue(reload.promise);
    agentsManager.streamingTextPersisted = true;
    agentsManager.sending = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Streamed answer')).toBeTruthy();

    reload.resolve([
      {
        id: 'persisted',
        threadId: thread.id,
        role: 'assistant',
        content: { text: 'Persisted answer' },
        createdAt: 2,
        runId: null,
      },
    ]);
    await screen.findByText('Persisted answer');
    expect(screen.queryByText('Streamed answer')).toBeNull();
    expect(agentsManager.streamingText).toBe('');
    expect(agentsManager.streamingTextPersisted).toBe(false);
  });

  it('shows the agent, provider and model in the bottom bar, and clears it on leave', async () => {
    const view = render(AgentChatView);
    await waitFor(() =>
      expect(viewManager.activeViewSubtitle).toBe('Asyar Assistant · provider-1 · model-1'),
    );
    view.unmount();
    expect(viewManager.activeViewSubtitle).toBeNull();
  });

  it("shows the thread's own provider and model in the bottom bar when it has an override", async () => {
    mockedAgentService.listThreads.mockResolvedValue([
      { ...thread, providerId: 'provider-2', modelId: 'model-2' },
    ]);
    render(AgentChatView);
    await waitFor(() =>
      expect(viewManager.activeViewSubtitle).toBe('Asyar Assistant · provider-2 · model-2'),
    );
  });

  it('offers a ⌘P agent switcher seeded with the open agent, not the saved pick', async () => {
    const research = { ...agent, id: 'agent-2', name: 'Research' };
    const silent = { ...agent, id: 'agent-3', name: 'Fix Grammar', silent: true };
    (mockedAgentService as any).agents = [agent, research, silent];
    render(AgentChatView);

    await waitFor(() => expect(searchBarAccessoryService.active).not.toBeNull());
    expect(searchBarAccessoryService.active).toMatchObject({
      extensionId: 'agents',
      commandId: 'ask',
      value: agent.id,
      options: [
        { value: agent.id, title: 'Asyar Assistant' },
        { value: research.id, title: 'Research' },
      ],
    });
    expect(agentsManager.currentAgentId).toBe(agent.id);
  });

  it('switches to the picked agent and lands on its latest thread', async () => {
    const research = { ...agent, id: 'agent-2', name: 'Research' };
    (mockedAgentService as any).agents = [agent, research];
    mockedAgentService.getById.mockImplementation((id: string) =>
      id === research.id ? research : agent,
    );
    render(AgentChatView);
    await waitFor(() => expect(searchBarAccessoryService.active).not.toBeNull());

    const researchThread = { ...thread, id: 'thread-r', agentId: research.id };
    mockedAgentService.listThreads.mockResolvedValue([researchThread]);
    await searchBarAccessoryService.set('agents', { value: research.id });

    expect(agentsManager.currentAgentId).toBe(research.id);
    await waitFor(() => expect(agentsManager.currentThreadId).toBe('thread-r'));
  });

  it('shows no agent switcher when there is only one agent', async () => {
    (mockedAgentService as any).agents = [agent];
    render(AgentChatView);
    await screen.findByText(thread.title);
    expect(searchBarAccessoryService.active).toBeNull();
  });

  it('leaves arrow keys to the ⌘P dropdown while it is open', async () => {
    const second = { ...thread, id: 'thread-2', title: 'Second Thread' };
    mockedAgentService.listThreads.mockResolvedValue([thread, second]);
    render(AgentChatView);
    await screen.findByText('Second Thread');

    searchBarAccessoryService.popoverOpen = true;
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(agentsManager.currentThreadId).toBe(thread.id);
  });

  it('renders tools unavailable notice when populated in agentsManager for active thread', async () => {
    agentsManager.toolsUnavailableNotice = {
      threadId: thread.id,
      tools: ['Weather', 'GitHub Issues'],
      engine: 'anthropic',
    };
    render(AgentChatView);

    const notice = await screen.findByTestId('tools-unavailable-notice');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain(
      "Claude Code (CLI) can't use these tools: Weather, GitHub Issues. To use them, switch this provider to an API key in Settings → AI.",
    );
  });

  it("does not show thread A's notice after switching to thread B", async () => {
    const thread2 = {
      id: 'thread-2',
      agentId: agent.id,
      title: 'Thread B',
      createdAt: 2,
      updatedAt: 2,
    };
    mockedAgentService.listThreads.mockResolvedValue([thread, thread2]);
    agentsManager.currentThreadId = thread.id;
    agentsManager.toolsUnavailableNotice = {
      threadId: thread.id,
      tools: ['Weather'],
      engine: 'anthropic',
    };

    render(AgentChatView);

    // Notice is visible on thread A
    expect(await screen.findByTestId('tools-unavailable-notice')).toBeTruthy();

    // Switch to thread B
    const threadB = await screen.findByText('Thread B');
    await fireEvent.click(threadB);

    // Notice should no longer be displayed on thread B
    expect(screen.queryByTestId('tools-unavailable-notice')).toBeNull();
  });
});
