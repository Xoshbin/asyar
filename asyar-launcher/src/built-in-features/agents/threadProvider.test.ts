import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: {
    currentAgentId: null as string | null,
    currentThreadId: null as string | null,
    threadsVersion: 0,
    threadsFor: vi.fn(),
    rememberThreads: vi.fn(),
  },
}));
vi.mock('./agentService.svelte', () => ({
  agentService: { setThreadProvider: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./agentChatView.helpers', () => ({ ensureThread: vi.fn() }));
vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

import { setActiveThreadModel } from './threadProvider';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { ensureThread } from './agentChatView.helpers';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

const thread = { id: 'thread-1', agentId: 'agent-1', providerId: null, modelId: null };

describe('setActiveThreadModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = 'thread-1';
    agentsManager.threadsVersion = 0;
    vi.mocked(agentsManager.threadsFor).mockReturnValue([thread] as any);
  });

  it('sets only the active thread and refreshes the known list', async () => {
    const ok = await setActiveThreadModel({ providerId: 'anthropic', modelId: 'claude' });

    expect(ok).toBe(true);
    expect(agentService.setThreadProvider).toHaveBeenCalledWith('thread-1', 'anthropic', 'claude');
    expect(agentsManager.rememberThreads).toHaveBeenCalledWith('agent-1', [
      { ...thread, providerId: 'anthropic', modelId: 'claude' },
    ]);
    expect(agentsManager.threadsVersion).toBe(1);
  });

  it('lets the thread follow its agent again with null', async () => {
    await setActiveThreadModel(null);
    expect(agentService.setThreadProvider).toHaveBeenCalledWith('thread-1', null, null);
  });

  it('starts a thread first when none is selected, so the first message uses it', async () => {
    agentsManager.currentThreadId = null;
    vi.mocked(ensureThread).mockResolvedValue({ id: 'fresh' } as any);

    await setActiveThreadModel({ providerId: 'anthropic', modelId: 'claude' });

    expect(agentsManager.currentThreadId).toBe('fresh');
    expect(agentService.setThreadProvider).toHaveBeenCalledWith('fresh', 'anthropic', 'claude');
  });

  it('does nothing without an agent', async () => {
    agentsManager.currentAgentId = null;
    expect(await setActiveThreadModel(null)).toBe(false);
    expect(agentService.setThreadProvider).not.toHaveBeenCalled();
  });

  it('reports a failed switch instead of throwing', async () => {
    vi.mocked(agentService.setThreadProvider).mockRejectedValueOnce(new Error('db'));
    expect(await setActiveThreadModel({ providerId: 'a', modelId: 'b' })).toBe(false);
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });
});
