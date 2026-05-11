import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks MUST be defined before the module under test is imported.

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: {
    currentAgentId: null as string | null,
    currentThreadId: null as string | null,
  },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    listThreads: vi.fn(),
  },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    navigateToView: vi.fn(),
  },
}));

vi.mock('./index', () => ({
  default: {
    onViewSubmit: vi.fn(),
  },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { openAgentForTab } from './threadOpener';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import agentsExtension from './index';

const thread1 = { id: 'thread-1', agentId: 'agent-a', title: 'First', createdAt: 1000, updatedAt: 2000 };
const thread2 = { id: 'thread-2', agentId: 'agent-a', title: 'Second', createdAt: 500, updatedAt: 1500 };

describe('openAgentForTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
  });

  it('sets currentAgentId on agentsManager', async () => {
    vi.mocked(agentService.listThreads).mockResolvedValue([]);
    await openAgentForTab('agent-x', 'hello', false);
    expect(agentsManager.currentAgentId).toBe('agent-x');
  });

  it('creates a fresh thread (currentThreadId stays null) when continueLastThread is false', async () => {
    vi.mocked(agentService.listThreads).mockResolvedValue([thread1, thread2]);
    await openAgentForTab('agent-a', 'query', false);
    expect(agentsManager.currentThreadId).toBeNull();
  });

  it('continues the most-recent thread when continueLastThread is true and threads exist', async () => {
    // listThreads returns newest first
    vi.mocked(agentService.listThreads).mockResolvedValue([thread1, thread2]);
    await openAgentForTab('agent-a', 'query', true);
    expect(agentsManager.currentThreadId).toBe('thread-1');
  });

  it('falls back to a fresh thread when continueLastThread is true but no threads exist', async () => {
    vi.mocked(agentService.listThreads).mockResolvedValue([]);
    await openAgentForTab('agent-a', 'query', true);
    expect(agentsManager.currentThreadId).toBeNull();
  });

  it('navigates to the agents chat view', async () => {
    vi.mocked(agentService.listThreads).mockResolvedValue([]);
    await openAgentForTab('agent-a', 'query', false);
    expect(viewManager.navigateToView).toHaveBeenCalledWith('agents/AgentChatView');
  });

  it('dispatches the initial query via onViewSubmit', async () => {
    vi.mocked(agentService.listThreads).mockResolvedValue([]);
    await openAgentForTab('agent-a', 'hello world', false);
    expect(agentsExtension.onViewSubmit).toHaveBeenCalledWith('hello world');
  });

  it('opens the chat view in empty state when agentId is null', async () => {
    await openAgentForTab(null, '', false);
    expect(agentsManager.currentAgentId).toBeNull();
    expect(agentsManager.currentThreadId).toBeNull();
    expect(viewManager.navigateToView).toHaveBeenCalledWith('agents/AgentChatView');
  });

  it('does not query threads when agentId is null', async () => {
    await openAgentForTab(null, '', false);
    expect(agentService.listThreads).not.toHaveBeenCalled();
  });
});
