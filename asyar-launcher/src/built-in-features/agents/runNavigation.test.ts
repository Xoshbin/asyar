import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  agentsFindRunOrigin: vi.fn(),
}));

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: {
    currentAgentId: null as string | null,
    currentThreadId: null as string | null,
  },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { agentsFindRunOrigin } from '../../lib/ipc/commands';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { agentsManager } from './agentsManager.svelte';
import { openAgentRunInChat } from './runNavigation';

describe('openAgentRunInChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
  });

  it('opens the chat view at the run origin', async () => {
    vi.mocked(agentsFindRunOrigin).mockResolvedValue({
      agentId: 'agent-1',
      threadId: 'thread-1',
    });

    await expect(openAgentRunInChat('run-1')).resolves.toBe(true);

    expect(agentsManager.currentAgentId).toBe('agent-1');
    expect(agentsManager.currentThreadId).toBe('thread-1');
    expect(viewManager.navigateToView).toHaveBeenCalledWith('agents/AgentChatView');
  });

  it('stays in the current view when the run has no persisted origin', async () => {
    vi.mocked(agentsFindRunOrigin).mockResolvedValue(null);

    await expect(openAgentRunInChat('run-1')).resolves.toBe(false);

    expect(viewManager.navigateToView).not.toHaveBeenCalled();
  });
});
