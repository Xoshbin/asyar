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
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

import { AgentsManager } from './agentsManager.svelte';
import { AgentService } from './agentService.svelte';
import { dispatchAgentCommand } from './dispatch';
import * as commands from '../../lib/ipc/commands';
import { viewManager } from '../../services/extension/viewManager.svelte';

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeAgent = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  name: 'Test Agent',
  description: null,
  systemPrompt: 'You are helpful.',
  providerId: 'openai',
  modelId: 'gpt-4',
  toolSelection: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

// ── AgentsManager ────────────────────────────────────────────────────────────

describe('AgentsManager', () => {
  let manager: AgentsManager;
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
    manager = new AgentsManager(service);
  });

  it('start_calls_replaceDynamicCommandsBuiltin_with_initial_agents', async () => {
    const a1 = makeAgent({ id: 'a1', name: 'Agent One' });
    const a2 = makeAgent({ id: 'a2', name: 'Agent Two' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1, a2] as never);
    await service.init();

    await manager.start();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith(
      'agents',
      expect.arrayContaining([
        expect.objectContaining({ id: 'a1', name: 'Agent One' }),
        expect.objectContaining({ id: 'a2', name: 'Agent Two' }),
      ]),
    );
    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect((regs as unknown[]).length).toBe(2);
  });

  it('refresh_after_create_calls_replaceDynamicCommandsBuiltin_with_updated_list', async () => {
    const a1 = makeAgent({ id: 'a1', name: 'Agent One' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();
    await manager.start();

    vi.mocked(commands.replaceDynamicCommandsBuiltin).mockClear();

    const a2 = makeAgent({ id: 'a2', name: 'Agent Two' });
    vi.mocked(commands.agentsCreate).mockResolvedValueOnce(a2 as never);
    await service.create({
      name: 'Agent Two',
      description: null,
      systemPrompt: 'hi',
      providerId: 'openai',
      modelId: 'gpt-4',
      toolSelection: [],
    });

    // Simulate the sync notification: agentService mutations must call manager.refresh()
    await manager.refresh();

    const lastCall = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls.at(-1)!;
    const regs = lastCall[1] as Array<{ id: string }>;
    expect(regs.length).toBe(2);
    expect(regs.map((r) => r.id)).toContain('a1');
    expect(regs.map((r) => r.id)).toContain('a2');
  });

  it('refresh_after_delete_calls_replaceDynamicCommandsBuiltin_with_reduced_list', async () => {
    const a1 = makeAgent({ id: 'a1' });
    const a2 = makeAgent({ id: 'a2' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1, a2] as never);
    await service.init();
    await manager.start();

    vi.mocked(commands.replaceDynamicCommandsBuiltin).mockClear();

    vi.mocked(commands.agentsDelete).mockResolvedValueOnce(undefined as never);
    await service.delete('a1');

    await manager.refresh();

    const lastCall = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls.at(-1)!;
    const regs = lastCall[1] as Array<{ id: string }>;
    expect(regs.length).toBe(1);
    expect(regs[0].id).toBe('a2');
  });

  it('stop_calls_replaceDynamicCommandsBuiltin_with_empty_array', async () => {
    vi.mocked(commands.agentsList).mockResolvedValueOnce([] as never);
    await service.init();
    await manager.start();

    vi.mocked(commands.replaceDynamicCommandsBuiltin).mockClear();

    await manager.stop();

    expect(commands.replaceDynamicCommandsBuiltin).toHaveBeenCalledWith('agents', []);
  });

  it('agent_dynamic_command_registration_carries_sparkles_icon', async () => {
    const a1 = makeAgent({ id: 'a1', name: 'Agent One' });
    const a2 = makeAgent({ id: 'a2', name: 'Agent Two' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1, a2] as never);
    await service.init();

    await manager.start();

    const [, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    for (const reg of regs as Array<{ icon: string }>) {
      expect(reg.icon).toBe('icon:sparkles');
    }
  });

  it('agent_dynamic_command_registration_uses_agent_id_directly', async () => {
    const a1 = makeAgent({ id: 'uuid-abc-123', name: 'My Agent' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    await manager.start();

    const [extensionId, regs] = vi.mocked(commands.replaceDynamicCommandsBuiltin).mock.calls[0];
    expect(extensionId).toBe('agents');
    const reg = (regs as Array<{ id: string; name: string }>)[0];
    // The registration id is the bare agent id — launcher derives cmd_agents_dyn_<id>
    expect(reg.id).toBe('uuid-abc-123');
    expect(reg.name).toBe('My Agent');
  });
});

// ── dispatchAgentCommand ─────────────────────────────────────────────────────

describe('dispatchAgentCommand', () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
  });

  it('navigates_to_AgentChatView_when_agent_exists', async () => {
    const a1 = makeAgent({ id: 'agent-uuid-1', name: 'Agent One' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    vi.mocked(commands.agentsThreadsList).mockResolvedValueOnce([] as never);
    await service.init();

    await dispatchAgentCommand('agent-uuid-1', undefined);

    expect(viewManager.navigateToView).toHaveBeenCalledWith('agents/AgentChatView');
  });

  it('throws_when_agent_not_found_by_dynamic_id', async () => {
    vi.mocked(commands.agentsList).mockResolvedValueOnce([] as never);
    await service.init();

    await expect(dispatchAgentCommand('unknown-id', undefined)).rejects.toThrow('unknown-id');
  });
});
