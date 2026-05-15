import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  agentsCreate: vi.fn(),
  agentsUpdate: vi.fn(),
  agentsDelete: vi.fn(),
  agentsList: vi.fn(),
  agentsGet: vi.fn(),
  agentsThreadCreate: vi.fn(),
  agentsThreadDelete: vi.fn(),
  agentsThreadsList: vi.fn(),
  agentsMessageInsert: vi.fn(),
  agentsMessagesList: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: { defaultAgentId: null },
    },
    updateSettings: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('./defaultAgent', () => ({
  buildDefaultAgentInput: vi.fn((providerId: string, modelId: string) => ({
    name: 'Asyar Assistant',
    description: 'Your built-in AI assistant',
    systemPrompt: 'You are Asyar Assistant...',
    providerId,
    modelId,
    toolSelection: [],
  })),
}));

import { AgentService } from './agentService.svelte';
import * as commands from '../../lib/ipc/commands';
import * as tauriEvent from '@tauri-apps/api/event';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { buildDefaultAgentInput } from './defaultAgent';

// ── Fixtures ───────────────────────────────────────────────────────────────────

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

const makeThread = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  agentId: 'a1',
  title: 'My Thread',
  createdAt: 2000,
  updatedAt: 2000,
  ...over,
});

const makeMessage = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  threadId: 't1',
  role: 'user' as const,
  content: { text: 'hi' },
  createdAt: 3000,
  runId: null,
  ...over,
});

const makeCreateInput = () => ({
  name: 'Test Agent',
  description: null,
  systemPrompt: 'You are helpful.',
  providerId: 'openai',
  modelId: 'gpt-4',
  toolSelection: [],
});

const makeUpdateInput = (id = 'a1') => ({
  id,
  name: 'New Name',
  description: null,
  systemPrompt: 'Updated.',
  providerId: 'openai',
  modelId: 'gpt-4',
  toolSelection: [],
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
  });

  it('init_populates_agents_from_agentsList', async () => {
    const agents = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })];
    vi.mocked(commands.agentsList).mockResolvedValueOnce(agents as never);

    await service.init();

    expect(service.agents).toHaveLength(2);
    expect(service.agents[0].id).toBe('a1');
    expect(service.agents[1].id).toBe('a2');
  });

  it('init_is_idempotent', async () => {
    vi.mocked(commands.agentsList).mockResolvedValue([] as never);

    await service.init();
    await service.init();

    expect(commands.agentsList).toHaveBeenCalledTimes(1);
  });

  it('create_appends_to_local_cache_and_returns_row', async () => {
    vi.mocked(commands.agentsList).mockResolvedValueOnce([] as never);
    await service.init();

    const created = makeAgent({ id: 'a2' });
    vi.mocked(commands.agentsCreate).mockResolvedValueOnce(created as never);

    const result = await service.create(makeCreateInput());

    expect(result).toEqual(created);
    expect(service.agents.find((a) => a.id === 'a2')).toBeDefined();
  });

  it('update_replaces_matching_id_in_local_cache', async () => {
    const initial = makeAgent({ id: 'a1', name: 'Old Name' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([initial] as never);
    await service.init();

    const updated = makeAgent({ id: 'a1', name: 'New Name' });
    vi.mocked(commands.agentsUpdate).mockResolvedValueOnce(updated as never);

    await service.update(makeUpdateInput('a1'));

    const cached = service.agents.find((a) => a.id === 'a1');
    expect(cached?.name).toBe('New Name');
    expect(service.agents).toHaveLength(1);
  });

  it('delete_removes_from_local_cache', async () => {
    const a1 = makeAgent({ id: 'a1' });
    const a2 = makeAgent({ id: 'a2' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1, a2] as never);
    await service.init();

    vi.mocked(commands.agentsDelete).mockResolvedValueOnce(undefined as never);

    await service.delete('a1');

    expect(service.agents).toHaveLength(1);
    expect(service.agents.find((a) => a.id === 'a1')).toBeUndefined();
  });

  it('getById_returns_matching_agent', async () => {
    const a1 = makeAgent({ id: 'a1' });
    const a2 = makeAgent({ id: 'a2' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1, a2] as never);
    await service.init();

    expect(service.getById('a1')).toEqual(a1);
    expect(service.getById('missing')).toBeUndefined();
  });

  it('listThreads_returns_result_of_agentsThreadsList', async () => {
    const threads = [makeThread()];
    vi.mocked(commands.agentsThreadsList).mockResolvedValueOnce(threads as never);

    const result = await service.listThreads('a1');

    expect(commands.agentsThreadsList).toHaveBeenCalledWith('a1');
    expect(result).toEqual(threads);
  });

  it('createThread_passes_agentId_and_title', async () => {
    const thread = makeThread({ title: 'My Thread' });
    vi.mocked(commands.agentsThreadCreate).mockResolvedValueOnce(thread as never);

    const result = await service.createThread('a1', 'My Thread');

    expect(commands.agentsThreadCreate).toHaveBeenCalledWith('a1', 'My Thread');
    expect(result).toEqual(thread);
  });

  it('insertMessage_forwards_args_to_agentsMessageInsert', async () => {
    const msg = makeMessage();
    vi.mocked(commands.agentsMessageInsert).mockResolvedValueOnce(msg as never);

    const input = { threadId: 't1', role: 'user' as const, content: { text: 'hi' }, runId: null };
    const result = await service.insertMessage(input);

    expect(commands.agentsMessageInsert).toHaveBeenCalledWith(input);
    expect(result).toEqual(msg);
  });

  it('create_reports_diagnostic_and_rethrows_on_failure', async () => {
    vi.mocked(commands.agentsList).mockResolvedValueOnce([] as never);
    await service.init();

    const boom = new Error('boom');
    vi.mocked(commands.agentsCreate).mockRejectedValueOnce(boom);

    await expect(service.create(makeCreateInput())).rejects.toThrow('boom');
    expect(diagnosticsService.report).toHaveBeenCalled();
  });

  it('update_reports_diagnostic_and_rethrows_on_failure', async () => {
    const a1 = makeAgent({ id: 'a1' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    const boom = new Error('update-boom');
    vi.mocked(commands.agentsUpdate).mockRejectedValueOnce(boom);

    await expect(service.update(makeUpdateInput('a1'))).rejects.toThrow('update-boom');
    expect(diagnosticsService.report).toHaveBeenCalled();
  });

  it('delete_reports_diagnostic_and_rethrows_on_failure', async () => {
    const a1 = makeAgent({ id: 'a1' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    const boom = new Error('delete-boom');
    vi.mocked(commands.agentsDelete).mockRejectedValueOnce(boom);

    await expect(service.delete('a1')).rejects.toThrow('delete-boom');
    expect(diagnosticsService.report).toHaveBeenCalled();
  });
});

// ── agents:changed cross-window sync ─────────────────────────────────────────

describe('agents:changed event sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriEvent.listen).mockResolvedValue(() => {});
  });

  it('constructor calls listen with agents:changed', () => {
    new AgentService();
    expect(tauriEvent.listen).toHaveBeenCalledWith('agents:changed', expect.any(Function));
  });

  it('refresh re-fetches agents list and updates this.agents', async () => {
    const initial = [makeAgent({ id: 'a1' })];
    const updated = [makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })];
    vi.mocked(commands.agentsList)
      .mockResolvedValueOnce(initial as never)
      .mockResolvedValueOnce(updated as never);

    const service = new AgentService();
    await service.init();
    expect(service.agents).toHaveLength(1);

    // Fire the event listener captured during construction
    const capturedListener = vi.mocked(tauriEvent.listen).mock.calls[0][1] as () => void;
    capturedListener();
    // Allow the async refresh to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(service.agents).toHaveLength(2);
  });
});

// ── default agent helpers ──────────────────────────────────────────────────────

describe('default agent helpers', () => {
  let service: AgentService;
  const svcSettings = settingsService as any;

  const agentA = makeAgent({ id: 'a', name: 'Agent A' });
  const agentB = makeAgent({ id: 'b', name: 'Agent B' });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mocked settings shape before each test
    svcSettings.currentSettings = { ai: { defaultAgentId: null } };
    service = new AgentService();
  });

  it('getDefaultAgent returns null when no agents and no defaultAgentId', () => {
    svcSettings.currentSettings.ai.defaultAgentId = null;
    service.agents = [];

    const result = service.getDefaultAgent();

    expect(result).toBeNull();
  });

  it('getDefaultAgent falls back to first agent when defaultAgentId is null but agents exist', () => {
    svcSettings.currentSettings.ai.defaultAgentId = null;
    service.agents = [agentA, agentB] as any;

    const result = service.getDefaultAgent();

    expect(result).toEqual(agentA);
  });

  it('getDefaultAgent falls back to first agent when defaultAgentId points to a deleted agent', () => {
    svcSettings.currentSettings.ai.defaultAgentId = 'ghost';
    service.agents = [agentA] as any;

    const result = service.getDefaultAgent();

    expect(result).toEqual(agentA);
  });

  it('getDefaultAgent returns the row matching defaultAgentId when present', () => {
    svcSettings.currentSettings.ai.defaultAgentId = 'b';
    service.agents = [agentA, agentB] as any;

    const result = service.getDefaultAgent();

    expect(result).toEqual(agentB);
  });

  it('getOrCreateDefaultAgent creates a new agent and writes settings.defaultAgentId when none exists', async () => {
    svcSettings.currentSettings.ai.defaultAgentId = null;
    service.agents = [];

    const newRow = makeAgent({ id: 'new-id', name: 'Asyar Assistant' });
    vi.mocked(commands.agentsCreate).mockResolvedValueOnce(newRow as never);

    const result = await service.getOrCreateDefaultAgent('openai', 'gpt-4o-mini');

    expect(result).toEqual(newRow);
    expect(buildDefaultAgentInput).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(vi.mocked(settingsService.updateSettings)).toHaveBeenCalledWith('ai', { defaultAgentId: 'new-id' });
  });

  it('getOrCreateDefaultAgent returns existing default without mutating settings', async () => {
    svcSettings.currentSettings.ai.defaultAgentId = 'a';
    service.agents = [agentA] as any;

    const result = await service.getOrCreateDefaultAgent('openai', 'gpt-4o-mini');

    expect(result).toEqual(agentA);
    expect(commands.agentsCreate).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });
});

// ── upsertDefaultAgent ────────────────────────────────────────────────────────

describe('upsertDefaultAgent', () => {
  let service: AgentService;
  const svcSettings = settingsService as any;

  const agentA = makeAgent({ id: 'a', name: 'Asyar Assistant', providerId: 'openai', modelId: 'gpt-4' });
  const agentB = makeAgent({ id: 'b', name: 'Other Agent', providerId: 'anthropic', modelId: 'claude-3' });

  beforeEach(() => {
    vi.clearAllMocks();
    svcSettings.currentSettings = { ai: { defaultAgentId: null } };
    service = new AgentService();
  });

  it('creates new agent and sets defaultAgentId when none exists', async () => {
    svcSettings.currentSettings.ai.defaultAgentId = null;
    service.agents = [];

    const newRow = makeAgent({ id: 'new-id', name: 'Asyar Assistant', providerId: 'anthropic', modelId: 'claude-3-5-sonnet' });
    vi.mocked(commands.agentsCreate).mockResolvedValueOnce(newRow as never);

    const result = await service.upsertDefaultAgent('anthropic', 'claude-3-5-sonnet');

    expect(result).toEqual(newRow);
    expect(commands.agentsCreate).toHaveBeenCalled();
    expect(vi.mocked(settingsService.updateSettings)).toHaveBeenCalledWith('ai', { defaultAgentId: 'new-id' });
  });

  it('updates existing default agent providerId and modelId', async () => {
    svcSettings.currentSettings.ai.defaultAgentId = 'a';
    service.agents = [agentA, agentB] as any;

    const updatedRow = makeAgent({ id: 'a', name: 'Asyar Assistant', providerId: 'anthropic', modelId: 'claude-3-5-sonnet' });
    vi.mocked(commands.agentsUpdate).mockResolvedValueOnce(updatedRow as never);

    const result = await service.upsertDefaultAgent('anthropic', 'claude-3-5-sonnet');

    expect(result).toEqual(updatedRow);
    expect(commands.agentsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', providerId: 'anthropic', modelId: 'claude-3-5-sonnet' })
    );
    expect(commands.agentsCreate).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('does not touch non-default agents', async () => {
    svcSettings.currentSettings.ai.defaultAgentId = 'a';
    service.agents = [agentA, agentB] as any;

    const updatedRow = makeAgent({ id: 'a', name: 'Asyar Assistant', providerId: 'openai', modelId: 'gpt-4o' });
    vi.mocked(commands.agentsUpdate).mockResolvedValueOnce(updatedRow as never);

    await service.upsertDefaultAgent('openai', 'gpt-4o');

    // agentB is untouched
    expect(service.agents.find((ag) => ag.id === 'b')).toEqual(agentB);
    expect(commands.agentsUpdate).toHaveBeenCalledTimes(1);
  });
});
