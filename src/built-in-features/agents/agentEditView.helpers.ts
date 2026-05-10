import type { AgentDef, AgentCreateInput, AgentUpdateInput } from './types';
import type { ToolDescriptor } from 'asyar-sdk/contracts';
import type { IProviderPlugin, ProviderConfig, ProviderId, ModelInfo } from '../../services/ai/IProviderPlugin';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditFormState {
  name: string;
  description: string | null;
  systemPrompt: string;
  providerId: string;
  modelId: string;
  toolSelection: Set<string>;
}

export type ToolGroup =
  | { kind: 'builtin'; tools: ToolDescriptor[] }
  | { kind: 'tier2'; extensionId: string; tools: ToolDescriptor[] };

export type ValidationResult = { ok: true } | { ok: false; error: string };

export interface SaveDeps {
  service: {
    create(input: AgentCreateInput): Promise<AgentDef>;
    update(input: AgentUpdateInput): Promise<AgentDef>;
  };
  manager: { refresh(): Promise<void> };
  viewManager: { goBack(): void };
}

// ── buildInitialFormState ─────────────────────────────────────────────────────

export function buildInitialFormState(agent: AgentDef | null): EditFormState {
  if (!agent) {
    return {
      name: '',
      description: null,
      systemPrompt: '',
      providerId: '',
      modelId: '',
      toolSelection: new Set(),
    };
  }
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    providerId: agent.providerId,
    modelId: agent.modelId,
    toolSelection: new Set(agent.toolSelection),
  };
}

// ── validateForm ──────────────────────────────────────────────────────────────

export function validateForm(state: EditFormState): ValidationResult {
  if (state.name.trim() === '') return { ok: false, error: 'Name is required' };
  if (state.systemPrompt.trim() === '') return { ok: false, error: 'System prompt is required' };
  if (state.providerId.trim() === '') return { ok: false, error: 'Provider is required' };
  if (state.modelId.trim() === '') return { ok: false, error: 'Model is required' };
  return { ok: true };
}

// ── Conversion helpers ────────────────────────────────────────────────────────

export function formStateToCreateInput(state: EditFormState): AgentCreateInput {
  return {
    name: state.name,
    description: state.description,
    systemPrompt: state.systemPrompt,
    providerId: state.providerId,
    modelId: state.modelId,
    toolSelection: Array.from(state.toolSelection),
  };
}

export function formStateToUpdateInput(state: EditFormState, id: string): AgentUpdateInput {
  return { id, ...formStateToCreateInput(state) };
}

// ── groupDescriptorsBySource ──────────────────────────────────────────────────

export function groupDescriptorsBySource(descriptors: ToolDescriptor[]): ToolGroup[] {
  const builtins: ToolDescriptor[] = [];
  const tier2Map = new Map<string, ToolDescriptor[]>();

  for (const d of descriptors) {
    if (d.source === 'builtin') {
      builtins.push(d);
    } else if (typeof d.source === 'object' && 'extensionId' in d.source) {
      const ext = d.source.extensionId;
      const arr = tier2Map.get(ext) ?? [];
      arr.push(d);
      tier2Map.set(ext, arr);
    }
  }

  const groups: ToolGroup[] = [];
  if (builtins.length > 0) groups.push({ kind: 'builtin', tools: builtins });
  for (const [extensionId, tools] of tier2Map) {
    groups.push({ kind: 'tier2', extensionId, tools });
  }
  return groups;
}

// ── toggleToolSelection ───────────────────────────────────────────────────────

export function toggleToolSelection(selected: Set<string>, fqid: string): Set<string> {
  const next = new Set(selected);
  if (next.has(fqid)) {
    next.delete(fqid);
  } else {
    next.add(fqid);
  }
  return next;
}

// ── selectInitialModelId ──────────────────────────────────────────────────────

/**
 * Pick which modelId to default-select for the agent form, in priority order:
 * 1. The current modelId on the form (preserves edit-mode user intent).
 * 2. The provider's `lastModelId` from settings (mirrors the model the user
 *    last picked in AiTab — sane carry-over default).
 * 3. The first fetched model.
 * 4. Empty string when nothing is known.
 */
export function selectInitialModelId(
  currentModelId: string,
  lastModelId: string,
  fetchedModels: ModelInfo[],
): string {
  if (currentModelId.trim() !== '') return currentModelId;
  if (lastModelId.trim() !== '') return lastModelId;
  return fetchedModels[0]?.id ?? '';
}

// ── filterAvailableProviders ──────────────────────────────────────────────────

/**
 * A provider is "available" for an agent when it is enabled in settings AND
 * has the credentials it requires (apiKey if `requiresApiKey`, baseUrl if
 * `requiresBaseUrl`). The agent edit dropdown surfaces only these so the user
 * can't pick a provider that would fail at send time.
 */
export function filterAvailableProviders(
  providers: IProviderPlugin[],
  configs: Record<ProviderId, ProviderConfig>,
): IProviderPlugin[] {
  return providers.filter((p) => {
    const config = configs[p.id];
    if (!config?.enabled) return false;
    if (p.requiresApiKey && !config.apiKey?.trim()) return false;
    if (p.requiresBaseUrl && !config.baseUrl?.trim()) return false;
    return true;
  });
}

// ── handleSave ────────────────────────────────────────────────────────────────

export async function handleSave(
  state: EditFormState,
  opts: { agentId?: string; deps: SaveDeps },
): Promise<void> {
  const validation = validateForm(state);
  if (!validation.ok) return;

  if (opts.agentId) {
    await opts.deps.service.update(formStateToUpdateInput(state, opts.agentId));
  } else {
    await opts.deps.service.create(formStateToCreateInput(state));
  }
  await opts.deps.manager.refresh();
  opts.deps.viewManager.goBack();
}
