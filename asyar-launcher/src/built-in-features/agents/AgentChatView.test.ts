// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentService.svelte', () => ({
  agentService: {
    getById: vi.fn(),
    listThreads: vi.fn(),
    listMessages: vi.fn(),
  },
}));

vi.mock('../../components', async () => ({
  Button: (await import('../../components/base/Button.svelte')).default,
  IconButton: (await import('../../components/base/IconButton.svelte')).default,
}));

vi.mock('../../services/log/logService', () => ({
  logService: { warn: vi.fn() },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsBackfillThreadTitles: vi.fn(),
  replaceDynamicCommandsBuiltin: vi.fn(),
  showSettingsWindow: vi.fn(),
}));

import AgentChatView from './AgentChatView.svelte';
import { agentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';
import type { MessageDef } from './types';

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes the sidebar when the selected thread is cleared after deletion', async () => {
    render(AgentChatView);
    await screen.findByText(thread.title);

    mockedAgentService.listThreads.mockResolvedValue([]);
    agentsManager.currentThreadId = null;

    await screen.findByText('No threads');
    await waitFor(() => expect(screen.queryByText(thread.title)).toBeNull());
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
});
