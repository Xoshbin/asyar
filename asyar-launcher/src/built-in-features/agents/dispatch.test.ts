/**
 * Contract tests for `dispatchAgentCommand`.
 *
 * Two contracts live in this file:
 *  1. Non-silent agents (`agent.silent === false`) navigate to the chat
 *     view and set `agentsManager.currentAgentId`. Default behavior.
 *  2. Silent agents (`agent.silent === true`) route to
 *     `dispatchSilentAgentCommand` and never touch `agentsManager` or
 *     `viewManager.navigateToView`. The launcher window stays
 *     closed; the result lands wherever the agent's outputAction puts it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  replaceDynamicCommandsBuiltin: vi.fn().mockResolvedValue(undefined),
  agentsList: vi.fn(),
  agentsCreate: vi.fn(),
  agentsUpdate: vi.fn(),
  agentsDelete: vi.fn(),
  agentsThreadsList: vi.fn(),
  agentsThreadCreate: vi.fn(),
  agentsThreadDelete: vi.fn(),
  agentsMessagesList: vi.fn(),
  agentsMessageInsert: vi.fn(),
  agentsBackfillThreadTitles: vi.fn().mockResolvedValue(0),
  agentsGet: vi.fn(),
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

// Mock the silent dispatcher so this test focuses purely on the routing
// decision in `dispatchAgentCommand` — the silentDispatch internals are
// covered by silentDispatch.test.ts.
vi.mock('./silentDispatch', () => ({
  dispatchSilentAgentCommand: vi.fn().mockResolvedValue(undefined),
}));

import { AgentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';
import { dispatchAgentCommand } from './dispatch';
import { dispatchSilentAgentCommand } from './silentDispatch';
import * as commands from '../../lib/ipc/commands';
import { viewManager } from '../../services/extension/viewManager.svelte';
import type { AgentDef } from './types';

function makeAgent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: null,
    systemPrompt: 'You are helpful.',
    providerId: 'openai',
    modelId: 'gpt-4o',
    toolSelection: [],
    silent: false,
    inputSource: 'argument',
    outputAction: 'replaceSelection',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe('dispatchAgentCommand — non-silent agents (default)', () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
  });

  it('navigates_to_AgentChatView_for_a_non_silent_agent', async () => {
    const a1 = makeAgent({ id: 'agent-1', silent: false });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    vi.mocked(commands.agentsThreadsList).mockResolvedValueOnce([] as never);
    await service.init();

    await dispatchAgentCommand('agent-1', undefined);

    expect(viewManager.navigateToView).toHaveBeenCalledWith('agents/AgentChatView');
    expect(agentsManager.currentAgentId).toBe('agent-1');
    expect(dispatchSilentAgentCommand).not.toHaveBeenCalled();
  });

  it('throws_when_agent_not_found', async () => {
    vi.mocked(commands.agentsList).mockResolvedValueOnce([] as never);
    await service.init();

    await expect(dispatchAgentCommand('unknown-id', undefined)).rejects.toThrow(
      'unknown-id',
    );
  });
});

describe('dispatchAgentCommand — silent agents', () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
  });

  it('routes_to_dispatchSilentAgentCommand_when_agent_is_silent', async () => {
    const a1 = makeAgent({ id: 'agent-1', silent: true });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    await dispatchAgentCommand('agent-1', undefined);

    expect(dispatchSilentAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
    );
  });

  it('does_not_navigate_to_AgentChatView_when_agent_is_silent', async () => {
    const a1 = makeAgent({ id: 'agent-1', silent: true });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    await dispatchAgentCommand('agent-1', undefined);

    expect(viewManager.navigateToView).not.toHaveBeenCalled();
  });

  it('does_not_set_currentAgentId_when_agent_is_silent', async () => {
    const a1 = makeAgent({ id: 'agent-1', silent: true });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    await dispatchAgentCommand('agent-1', undefined);

    expect(agentsManager.currentAgentId).toBeNull();
  });
});
