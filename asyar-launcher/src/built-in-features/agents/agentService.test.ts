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
  agentsResolveDefault: vi.fn(),
  agentsUpsertDefault: vi.fn(),
  agentsSeedGrammarFix: vi.fn(),
  agentsSeedEmojiFallback: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: { defaultAgentId: null },
    },
    updateSettings: vi.fn().mockResolvedValue(true),
  },
}));

const mockShortcutRegister = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock('../shortcuts/shortcutService', () => ({
  shortcutService: { register: mockShortcutRegister },
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AgentService } from './agentService.svelte';
import * as commands from '../../lib/ipc/commands';
import * as tauriEvent from '@tauri-apps/api/event';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';

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

    vi.mocked(commands.agentsDelete).mockResolvedValueOnce(true);

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

    vi.mocked(commands.agentsCreate).mockResolvedValueOnce(null as never);

    await expect(service.create(makeCreateInput())).rejects.toThrow();
    expect(feedbackService.report).toHaveBeenCalled();
  });

  it('update_reports_diagnostic_and_rethrows_on_failure', async () => {
    const a1 = makeAgent({ id: 'a1' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    vi.mocked(commands.agentsUpdate).mockResolvedValueOnce(null as never);

    await expect(service.update(makeUpdateInput('a1'))).rejects.toThrow();
    expect(feedbackService.report).toHaveBeenCalled();
  });

  it('delete_reports_diagnostic_and_rethrows_on_failure', async () => {
    const a1 = makeAgent({ id: 'a1' });
    vi.mocked(commands.agentsList).mockResolvedValueOnce([a1] as never);
    await service.init();

    vi.mocked(commands.agentsDelete).mockResolvedValueOnce(false);

    await expect(service.delete('a1')).rejects.toThrow();
    expect(feedbackService.report).toHaveBeenCalled();
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

describe('Rust-owned agent lifecycle', () => {
  let service: AgentService;
  const svcSettings = settingsService as any;

  beforeEach(() => {
    vi.clearAllMocks();
    svcSettings.currentSettings = { ai: { defaultAgentId: null } };
    service = new AgentService();
  });

  it('loads the default selection from Rust instead of selecting from the TS array', async () => {
    const defaultAgent = makeAgent({ id: 'b' });
    vi.mocked(commands.agentsList).mockResolvedValue([
      makeAgent({ id: 'a' }),
      defaultAgent,
    ] as never);
    vi.mocked(commands.agentsResolveDefault).mockResolvedValue(defaultAgent as never);

    await service.init();

    expect(commands.agentsResolveDefault).toHaveBeenCalledWith(null);
    expect(service.getDefaultAgent()).toEqual(defaultAgent);
  });

  it('delegates default upsert to Rust and stores the returned id in settings', async () => {
    const row = makeAgent({ id: 'default-1', providerId: 'anthropic', modelId: 'claude-sonnet' });
    vi.mocked(commands.agentsUpsertDefault).mockResolvedValue(row as never);

    const result = await service.upsertDefaultAgent('anthropic', 'claude-sonnet');

    expect(commands.agentsUpsertDefault).toHaveBeenCalledWith(null, 'anthropic', 'claude-sonnet');
    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      defaultAgentId: 'default-1',
    });
    expect(service.getDefaultAgent()).toEqual(row);
    expect(result).toEqual(row);
  });

  it('delegates idempotent Grammar Fix seeding to Rust', async () => {
    const row = makeAgent({ id: 'grammar-1', name: 'Grammar Fix', silent: true });
    vi.mocked(commands.agentsSeedGrammarFix).mockResolvedValue(row as never);

    await expect(service.seedGrammarFixAgent('openai', 'gpt-4o')).resolves.toEqual(row);

    expect(commands.agentsSeedGrammarFix).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('delegates idempotent Emoji Fallback seeding to Rust', async () => {
    const row = makeAgent({ id: 'emoji-1', name: 'Inline Emoji Fallback', silent: true });
    vi.mocked(commands.agentsSeedEmojiFallback).mockResolvedValue(row as never);

    await expect(service.seedEmojiFallbackAgent('openai', 'gpt-4o')).resolves.toEqual(row);

    expect(commands.agentsSeedEmojiFallback).toHaveBeenCalledWith('openai', 'gpt-4o');
  });
});
