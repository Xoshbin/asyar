import { describe, it, expect, vi } from 'vitest';

import {
  buildInitialFormState,
  validateForm,
  formStateToCreateInput,
  formStateToUpdateInput,
  groupDescriptorsBySource,
  toggleToolSelection,
  handleSave,
  filterAvailableProviders,
  selectInitialModelId,
} from './agentEditView.helpers';

import type { EditFormState } from './agentEditView.helpers';
import type { AgentDef } from './types';
import type { ToolDescriptor } from 'asyar-sdk/contracts';
import type { IProviderPlugin, ProviderId, ProviderConfig, ModelInfo } from '../../services/ai/IProviderPlugin';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeAgent = (over: Partial<AgentDef> = {}): AgentDef => ({
  id: 'agent-1',
  name: 'Test Agent',
  description: 'A helpful agent',
  systemPrompt: 'You are helpful.',
  providerId: 'openai',
  modelId: 'gpt-4',
  toolSelection: ['builtin:echo', 'ext-a:search'],
  createdAt: 1000,
  updatedAt: 2000,
  ...over,
});

const makeState = (over: Partial<EditFormState> = {}): EditFormState => ({
  name: 'My Agent',
  description: 'Does things',
  systemPrompt: 'Be helpful.',
  providerId: 'openai',
  modelId: 'gpt-4',
  toolSelection: new Set(['builtin:echo']),
  ...over,
});

const makeDescriptor = (
  id: string,
  source: ToolDescriptor['source'],
): ToolDescriptor => {
  let fqid: `${string}:${string}`;
  if (source === 'builtin') {
    fqid = `builtin:${id}`;
  } else if ('extensionId' in source) {
    fqid = `${source.extensionId}:${id}`;
  } else {
    fqid = `mcp:${(source as { mcpServerId: string }).mcpServerId}:${id}`;
  }
  return {
    id,
    name: id,
    description: `${id} description`,
    parameters: {},
    source,
    fullyQualifiedId: fqid,
  };
};

// ── buildInitialFormState ─────────────────────────────────────────────────────

describe('buildInitialFormState', () => {
  it('buildInitialFormState_returns_empty_form_when_agent_is_null', () => {
    const state = buildInitialFormState(null);
    expect(state.name).toBe('');
    expect(state.description).toBeNull();
    expect(state.systemPrompt).toBe('');
    expect(state.providerId).toBe('');
    expect(state.modelId).toBe('');
    expect(state.toolSelection).toBeInstanceOf(Set);
    expect(state.toolSelection.size).toBe(0);
  });

  it('buildInitialFormState_populates_form_from_agent', () => {
    const agent = makeAgent();
    const state = buildInitialFormState(agent);
    expect(state.name).toBe(agent.name);
    expect(state.description).toBe(agent.description);
    expect(state.systemPrompt).toBe(agent.systemPrompt);
    expect(state.providerId).toBe(agent.providerId);
    expect(state.modelId).toBe(agent.modelId);
    expect(state.toolSelection).toBeInstanceOf(Set);
    expect(state.toolSelection.has('builtin:echo')).toBe(true);
    expect(state.toolSelection.has('ext-a:search')).toBe(true);
    expect(state.toolSelection.size).toBe(2);
  });
});

// ── validateForm ──────────────────────────────────────────────────────────────

describe('validateForm', () => {
  it('validateForm_rejects_empty_name', () => {
    const result = validateForm(makeState({ name: '' }));
    expect(result.ok).toBe(false);
  });

  it('validateForm_rejects_empty_systemPrompt', () => {
    const result = validateForm(makeState({ systemPrompt: '' }));
    expect(result.ok).toBe(false);
  });

  it('validateForm_rejects_empty_providerId', () => {
    const result = validateForm(makeState({ providerId: '' }));
    expect(result.ok).toBe(false);
  });

  it('validateForm_rejects_empty_modelId', () => {
    const result = validateForm(makeState({ modelId: '' }));
    expect(result.ok).toBe(false);
  });

  it('validateForm_passes_with_all_required_filled', () => {
    const result = validateForm(makeState());
    expect(result.ok).toBe(true);
  });
});

// ── Conversion helpers ────────────────────────────────────────────────────────

describe('formStateToCreateInput', () => {
  it('formStateToCreateInput_converts_state_to_create_payload', () => {
    const state = makeState({ toolSelection: new Set(['builtin:echo', 'ext-a:search']) });
    const input = formStateToCreateInput(state);
    expect(input.name).toBe(state.name);
    expect(input.description).toBe(state.description);
    expect(input.systemPrompt).toBe(state.systemPrompt);
    expect(input.providerId).toBe(state.providerId);
    expect(input.modelId).toBe(state.modelId);
    expect(Array.isArray(input.toolSelection)).toBe(true);
    expect(input.toolSelection).toContain('builtin:echo');
    expect(input.toolSelection).toContain('ext-a:search');
  });
});

describe('formStateToUpdateInput', () => {
  it('formStateToUpdateInput_includes_id', () => {
    const state = makeState();
    const input = formStateToUpdateInput(state, 'agent-99');
    expect(input.id).toBe('agent-99');
  });

  it('formStateToUpdateInput_converts_state_to_update_payload', () => {
    const state = makeState({ toolSelection: new Set(['builtin:echo']) });
    const input = formStateToUpdateInput(state, 'agent-99');
    expect(input.name).toBe(state.name);
    expect(input.systemPrompt).toBe(state.systemPrompt);
    expect(input.providerId).toBe(state.providerId);
    expect(input.modelId).toBe(state.modelId);
    expect(Array.isArray(input.toolSelection)).toBe(true);
    expect(input.toolSelection).toContain('builtin:echo');
    expect(input.id).toBe('agent-99');
  });
});

// ── groupDescriptorsBySource ──────────────────────────────────────────────────

describe('groupDescriptorsBySource', () => {
  it('groupDescriptorsBySource_separates_builtin_from_tier2', () => {
    const descriptors: ToolDescriptor[] = [
      makeDescriptor('echo', 'builtin'),
      makeDescriptor('search', { extensionId: 'ext-a' }),
    ];
    const groups = groupDescriptorsBySource(descriptors);
    const builtinGroup = groups.find((g) => g.kind === 'builtin');
    const tier2Group = groups.find((g) => g.kind === 'tier2');
    expect(builtinGroup).toBeDefined();
    expect(tier2Group).toBeDefined();
    expect(builtinGroup!.tools).toHaveLength(1);
    expect(tier2Group!.extensionId).toBe('ext-a');
    expect(tier2Group!.tools).toHaveLength(1);
  });

  it('groupDescriptorsBySource_orders_builtin_first', () => {
    const descriptors: ToolDescriptor[] = [
      makeDescriptor('search', { extensionId: 'ext-a' }),
      makeDescriptor('echo', 'builtin'),
    ];
    const groups = groupDescriptorsBySource(descriptors);
    expect(groups[0].kind).toBe('builtin');
  });

  it('groupDescriptorsBySource_groups_multiple_tools_per_extension', () => {
    const descriptors: ToolDescriptor[] = [
      makeDescriptor('tool1', { extensionId: 'ext-b' }),
      makeDescriptor('tool2', { extensionId: 'ext-b' }),
      makeDescriptor('tool3', { extensionId: 'ext-b' }),
    ];
    const groups = groupDescriptorsBySource(descriptors);
    const ext = groups.find((g) => g.kind === 'tier2' && g.extensionId === 'ext-b');
    expect(ext).toBeDefined();
    expect(ext!.tools).toHaveLength(3);
  });

  it('groupDescriptorsBySource_returns_empty_when_no_descriptors', () => {
    const groups = groupDescriptorsBySource([]);
    expect(groups).toEqual([]);
  });

  it('groupDescriptorsBySource handles mcp source', () => {
    const descriptors: ToolDescriptor[] = [
      makeDescriptor('search_user', { mcpServerId: 'srv-acme' }),
      makeDescriptor('list_repos', { mcpServerId: 'srv-acme' }),
    ];
    const groups = groupDescriptorsBySource(descriptors);
    const mcpGroup = groups.find((g) => g.kind === 'mcp');
    expect(mcpGroup).toBeDefined();
    expect(mcpGroup!.serverId).toBe('srv-acme');
    expect(mcpGroup!.tools).toHaveLength(2);
  });

  it('groupDescriptorsBySource orders builtin, tier2, then mcp groups', () => {
    const descriptors: ToolDescriptor[] = [
      makeDescriptor('mcp_tool', { mcpServerId: 'srv-x' }),
      makeDescriptor('ext_tool', { extensionId: 'ext-a' }),
      makeDescriptor('echo', 'builtin'),
    ];
    const groups = groupDescriptorsBySource(descriptors);
    expect(groups[0].kind).toBe('builtin');
    expect(groups[1].kind).toBe('tier2');
    expect(groups[2].kind).toBe('mcp');
  });

  it('groupDescriptorsBySource separates multiple mcp servers into distinct groups', () => {
    const descriptors: ToolDescriptor[] = [
      makeDescriptor('tool_a', { mcpServerId: 'srv-1' }),
      makeDescriptor('tool_b', { mcpServerId: 'srv-2' }),
      makeDescriptor('tool_c', { mcpServerId: 'srv-1' }),
    ];
    const groups = groupDescriptorsBySource(descriptors);
    const mcpGroups = groups.filter((g) => g.kind === 'mcp');
    expect(mcpGroups).toHaveLength(2);
    const srv1 = mcpGroups.find((g) => g.kind === 'mcp' && g.serverId === 'srv-1');
    const srv2 = mcpGroups.find((g) => g.kind === 'mcp' && g.serverId === 'srv-2');
    expect(srv1).toBeDefined();
    expect(srv1!.tools).toHaveLength(2);
    expect(srv2).toBeDefined();
    expect(srv2!.tools).toHaveLength(1);
  });
});

// ── toggleToolSelection ───────────────────────────────────────────────────────

describe('toggleToolSelection', () => {
  it('toggleToolSelection_adds_when_absent', () => {
    const selected = new Set<string>(['builtin:echo']);
    const result = toggleToolSelection(selected, 'ext-a:search');
    expect(result.has('ext-a:search')).toBe(true);
  });

  it('toggleToolSelection_removes_when_present', () => {
    const selected = new Set<string>(['builtin:echo', 'ext-a:search']);
    const result = toggleToolSelection(selected, 'builtin:echo');
    expect(result.has('builtin:echo')).toBe(false);
    expect(result.has('ext-a:search')).toBe(true);
  });

  it('toggleToolSelection_returns_new_set_not_mutated_input', () => {
    const selected = new Set<string>(['builtin:echo']);
    const result = toggleToolSelection(selected, 'ext-a:search');
    expect(result).not.toBe(selected);
    expect(selected.has('ext-a:search')).toBe(false);
  });
});

// ── handleSave ────────────────────────────────────────────────────────────────

describe('handleSave', () => {
  it('handleSave_calls_create_when_no_agentId', async () => {
    const callOrder: string[] = [];
    const fakeAgent = makeAgent();
    const service = {
      create: vi.fn().mockImplementation(async () => {
        callOrder.push('create');
        return fakeAgent;
      }),
      update: vi.fn(),
    };
    const manager = {
      refresh: vi.fn().mockImplementation(async () => {
        callOrder.push('refresh');
      }),
    };
    const viewManager = {
      goBack: vi.fn().mockImplementation(() => {
        callOrder.push('goBack');
      }),
    };

    await handleSave(makeState(), { deps: { service, manager, viewManager } });

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.update).not.toHaveBeenCalled();
    expect(manager.refresh).toHaveBeenCalledTimes(1);
    expect(viewManager.goBack).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['create', 'refresh', 'goBack']);
  });

  it('handleSave_calls_update_when_agentId_present', async () => {
    const fakeAgent = makeAgent();
    const service = {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(fakeAgent),
    };
    const manager = { refresh: vi.fn().mockResolvedValue(undefined) };
    const viewManager = { goBack: vi.fn() };

    await handleSave(makeState(), {
      agentId: 'agent-1',
      deps: { service, manager, viewManager },
    });

    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-1' }),
    );
    expect(service.create).not.toHaveBeenCalled();
    expect(manager.refresh).toHaveBeenCalledTimes(1);
    expect(viewManager.goBack).toHaveBeenCalledTimes(1);
  });

  it('handleSave_does_not_navigate_when_validation_fails', async () => {
    const service = { create: vi.fn(), update: vi.fn() };
    const manager = { refresh: vi.fn() };
    const viewManager = { goBack: vi.fn() };

    const invalidState = makeState({ name: '' });

    await handleSave(invalidState, { deps: { service, manager, viewManager } });

    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(viewManager.goBack).not.toHaveBeenCalled();
  });
});

// ── filterAvailableProviders ─────────────────────────────────────────────────

describe('filterAvailableProviders', () => {
  const makePlugin = (id: ProviderId, requiresApiKey = true, requiresBaseUrl = false): IProviderPlugin =>
    ({ id, name: id, requiresApiKey, requiresBaseUrl } as unknown as IProviderPlugin);

  const makeConfigs = (
    overrides: Partial<Record<ProviderId, Partial<ProviderConfig>>>,
  ): Record<ProviderId, ProviderConfig> => {
    const out = {} as Record<ProviderId, ProviderConfig>;
    for (const [k, v] of Object.entries(overrides)) {
      out[k as ProviderId] = { enabled: false, ...v };
    }
    return out;
  };

  it('excludes disabled providers even when an api key is set', () => {
    const providers = [makePlugin('openai')];
    const configs = makeConfigs({ openai: { enabled: false, apiKey: 'sk-x' } });
    expect(filterAvailableProviders(providers, configs)).toEqual([]);
  });

  it('excludes providers requiring an api key when key is missing or empty', () => {
    const providers = [makePlugin('openai'), makePlugin('anthropic')];
    const configs = makeConfigs({
      openai: { enabled: true, apiKey: '' },
      anthropic: { enabled: true },
    });
    expect(filterAvailableProviders(providers, configs)).toEqual([]);
  });

  it('includes enabled providers with an api key', () => {
    const providers = [makePlugin('openai'), makePlugin('anthropic')];
    const configs = makeConfigs({
      openai: { enabled: true, apiKey: 'sk-x' },
      anthropic: { enabled: true, apiKey: 'sk-y' },
    });
    expect(filterAvailableProviders(providers, configs).map((p) => p.id)).toEqual(['openai', 'anthropic']);
  });

  it('includes enabled providers that do not require an api key', () => {
    const providers = [makePlugin('ollama', false, true)];
    const configs = makeConfigs({ ollama: { enabled: true, baseUrl: 'http://localhost:11434' } });
    expect(filterAvailableProviders(providers, configs).map((p) => p.id)).toEqual(['ollama']);
  });

  it('excludes providers requiring a base url when base url is missing', () => {
    const providers = [makePlugin('ollama', false, true)];
    const configs = makeConfigs({ ollama: { enabled: true } });
    expect(filterAvailableProviders(providers, configs)).toEqual([]);
  });

  it('returns empty when configs map is empty', () => {
    const providers = [makePlugin('openai')];
    const configs = {} as Record<ProviderId, ProviderConfig>;
    expect(filterAvailableProviders(providers, configs)).toEqual([]);
  });
});

// ── selectInitialModelId ─────────────────────────────────────────────────────

describe('selectInitialModelId', () => {
  const m = (id: string): ModelInfo => ({ id, label: id });

  it('returns the current modelId when it is non-empty (edit mode)', () => {
    expect(selectInitialModelId('gpt-4', 'haiku', [m('opus'), m('sonnet')])).toBe('gpt-4');
  });

  it('returns lastModelId when current is empty and lastModelId is in the fetched list', () => {
    expect(selectInitialModelId('', 'sonnet', [m('opus'), m('sonnet')])).toBe('sonnet');
  });

  it('returns lastModelId even when not in fetched list (user override survives)', () => {
    expect(selectInitialModelId('', 'haiku', [m('opus'), m('sonnet')])).toBe('haiku');
  });

  it('returns first fetched model when current and lastModelId are empty', () => {
    expect(selectInitialModelId('', '', [m('opus'), m('sonnet')])).toBe('opus');
  });

  it('returns empty string when nothing is available', () => {
    expect(selectInitialModelId('', '', [])).toBe('');
  });

  it('treats whitespace-only currentModelId as empty', () => {
    expect(selectInitialModelId('   ', 'sonnet', [m('sonnet')])).toBe('sonnet');
  });
});
