import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./invokeSafe', () => ({
  invokeSafe: vi.fn(),
  invokeSafeVoid: vi.fn(),
  invokeRaw: vi.fn(),
}));

import { invokeRaw } from './invokeSafe';
import {
  agentsCancelRun,
  agentsEditorLoad,
  agentsEditorListModels,
  agentsEditorSave,
  agentsProviderRemovalBlockers,
  agentsSeedEmojiFallback,
  agentsReportMcpPermission,
  agentsReportToolResult,
  agentsResolveDefault,
  agentsRunSilent,
  agentsRunThread,
  agentsSeedGrammarFix,
  agentsUpsertDefault,
} from './commands';
import type { AgentDef } from '../../built-in-features/agents/types';
import type { AgentRunConfig } from './commands';

const config: AgentRunConfig = {
  provider: { enabled: true, apiKey: 'test-key' },
  temperature: 0.25,
  maxTokens: 123,
};

const agent: AgentDef = {
  id: 'agent-1',
  name: 'Agent',
  description: null,
  systemPrompt: 'Help',
  providerId: 'openai',
  modelId: 'gpt-4o',
  toolSelection: [],
  silent: true,
  inputSource: 'argument',
  outputAction: 'copy',
  createdAt: null,
  updatedAt: null,
};

describe('agent runner commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invokeRaw).mockResolvedValue(undefined);
  });

  it('starts a persistent Rust agent run with the complete contract', async () => {
    await agentsRunThread('agent-1', 'thread-1', 'hello', 'run-1', config, 'stream-1');

    expect(invokeRaw).toHaveBeenCalledWith('agents_run_thread', {
      agentId: 'agent-1',
      threadId: 'thread-1',
      userText: 'hello',
      runId: 'run-1',
      config,
      streamId: 'stream-1',
    });
  });

  it('starts an ephemeral Rust run using the stored agent id', async () => {
    vi.mocked(invokeRaw).mockResolvedValueOnce('answer');

    await expect(agentsRunSilent('agent-1', 'hello', config, 'stream-2')).resolves.toBe('answer');
    expect(invokeRaw).toHaveBeenCalledWith('agents_run_silent', {
      agentId: 'agent-1',
      userText: 'hello',
      config,
      streamId: 'stream-2',
    });
  });

  it('delegates default resolution and bundled profile lifecycle to Rust', async () => {
    vi.mocked(invokeRaw).mockResolvedValue(agent);

    await agentsResolveDefault('default-1');
    await agentsUpsertDefault('default-1', 'openai', 'gpt-4o');
    await agentsSeedGrammarFix('openai', 'gpt-4o');
    await agentsSeedEmojiFallback('openai', 'gpt-4o');

    expect(vi.mocked(invokeRaw).mock.calls).toEqual([
      ['agents_resolve_default', { defaultAgentId: 'default-1' }],
      [
        'agents_upsert_default',
        { defaultAgentId: 'default-1', providerId: 'openai', modelId: 'gpt-4o' },
      ],
      ['agents_seed_grammar_fix', { providerId: 'openai', modelId: 'gpt-4o' }],
      ['agents_seed_emoji_fallback', { providerId: 'openai', modelId: 'gpt-4o' }],
    ]);
  });

  it('reports tool success and failure through the four-field resume contract', async () => {
    await agentsReportToolResult('stream-1', 'call-1', { answer: 42 });
    await agentsReportToolResult('stream-1', 'call-2', null, 'tool failed');

    expect(vi.mocked(invokeRaw).mock.calls).toEqual([
      [
        'agents_report_tool_result',
        { streamId: 'stream-1', toolCallId: 'call-1', result: { answer: 42 }, error: null },
      ],
      [
        'agents_report_tool_result',
        { streamId: 'stream-1', toolCallId: 'call-2', result: null, error: 'tool failed' },
      ],
    ]);
  });

  it('reports an MCP permission decision to the suspended Rust executor', async () => {
    await agentsReportMcpPermission('stream-1', 'call-1', 'allow_always');

    expect(invokeRaw).toHaveBeenCalledWith('agents_report_mcp_permission', {
      streamId: 'stream-1',
      toolCallId: 'call-1',
      decision: 'allow_always',
    });
  });

  it('cancels the Rust runner by stream id', async () => {
    await agentsCancelRun('stream-1');

    expect(invokeRaw).toHaveBeenCalledWith('agents_cancel_run', { streamId: 'stream-1' });
  });

  it('asks Rust for presentation-ready agent editor providers and tool groups', async () => {
    const configs = {
      openai: { enabled: true, apiKey: 'secret' },
    } as any;
    const providers = [
      {
        id: 'openai',
        name: 'OpenAI',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: vi.fn(),
      },
    ] as any;
    vi.mocked(invokeRaw).mockResolvedValueOnce({ providers: [], toolGroups: [] });

    await agentsEditorLoad(null, 'default-agent-1', providers, configs);

    expect(invokeRaw).toHaveBeenCalledWith('agents_editor_load', {
      agentId: null,
      defaultAgentId: 'default-agent-1',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          requiresApiKey: true,
          requiresBaseUrl: false,
        },
      ],
      configs,
    });
  });

  it('submits the editor form to Rust for validation and persistence', async () => {
    const form = {
      name: 'Agent',
      description: '',
      systemPrompt: 'Help',
      providerId: 'openai',
      modelId: 'gpt-4o',
      toolSelection: [],
      silent: false,
      inputSource: 'argument' as const,
      outputAction: 'replaceSelection' as const,
    };
    vi.mocked(invokeRaw).mockResolvedValueOnce(agent);

    await agentsEditorSave(null, form);

    expect(invokeRaw).toHaveBeenCalledWith('agents_editor_save', { agentId: null, form });
  });

  it('asks Rust to discover models and choose the editor default', async () => {
    vi.mocked(invokeRaw).mockResolvedValueOnce({
      models: [{ id: 'gpt-4o', label: 'GPT-4o', reasoningEfforts: null }],
      selectedModelId: 'gpt-4o',
    });

    await expect(
      agentsEditorListModels('openai', { enabled: true, apiKey: 'secret' }, ''),
    ).resolves.toEqual({
      models: [{ id: 'gpt-4o', label: 'GPT-4o', reasoningEfforts: undefined }],
      selectedModelId: 'gpt-4o',
    });
    expect(invokeRaw).toHaveBeenCalledWith('agents_editor_list_models', {
      providerId: 'openai',
      config: { enabled: true, apiKey: 'secret' },
      currentModelId: '',
    });
  });

  it('asks Rust which agents would be stranded by removing a provider', async () => {
    const configs = {
      openai: { enabled: true, apiKey: 'secret' },
    } as any;
    const providers = [
      {
        id: 'openai',
        name: 'OpenAI',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: vi.fn(),
      },
    ] as any;
    vi.mocked(invokeRaw).mockResolvedValueOnce([{ id: 'agent-1', name: 'Asyar Assistant' }]);

    await expect(agentsProviderRemovalBlockers('openai', providers, configs)).resolves.toEqual([
      { id: 'agent-1', name: 'Asyar Assistant' },
    ]);

    expect(invokeRaw).toHaveBeenCalledWith('agents_provider_removal_blockers', {
      providerId: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          requiresApiKey: true,
          requiresBaseUrl: false,
        },
      ],
      configs,
    });
  });
});
