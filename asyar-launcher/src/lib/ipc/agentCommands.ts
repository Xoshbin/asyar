// asyar-launcher/src/lib/ipc/agentCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid, invokeRaw } from './invokeSafe';
import type {
  IProviderPlugin,
  ModelInfo,
  ProviderConfig,
  ProviderId,
  ReasoningEffort,
} from '../../services/ai/IProviderPlugin';
import type { AgentProviderDescriptor, ModelInfo as ModelInfoContract } from '../../bindings';

// ── Agents ────────────────────────────────────────────────────────────────────

// agentsCreate/agentsUpdate/agentsList are silent: agentService.svelte.ts is
// their sole caller and already reports its own (more specific) diagnostic
// on a null result — letting invokeSafe also report would double-report.
export async function agentsCreate(
  input: import('../../built-in-features/agents/types').AgentCreateInput,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeSafe('agents_create', { input }, { silent: true });
}

export async function agentsUpdate(
  input: import('../../built-in-features/agents/types').AgentUpdateInput,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeSafe('agents_update', { input }, { silent: true });
}

// boolean (not void): agentService.svelte.ts gates its optimistic local
// state update on success, and reports its own diagnostic on failure.
export async function agentsDelete(id: string): Promise<boolean> {
  return invokeSafeVoid('agents_delete', { id }, { silent: true });
}

export async function agentsList(): Promise<
  import('../../built-in-features/agents/types').AgentDef[] | null
> {
  return invokeSafe('agents_list', undefined, { silent: true });
}

export async function agentsGet(
  id: string,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeSafe('agents_get', { id });
}

export async function agentsThreadCreate(
  agentId: string,
  title?: string | null,
): Promise<import('../../built-in-features/agents/types').ThreadDef | null> {
  return invokeSafe('agents_thread_create', { input: { agentId, title: title ?? null } });
}

export async function agentsThreadDelete(id: string): Promise<void> {
  await invokeSafe('agents_thread_delete', { id });
}

export async function agentsThreadUpdateTitle(id: string, title: string): Promise<void> {
  await invokeSafe('agents_thread_update_title', { id, title });
}

export interface AgentRunOrigin {
  agentId: string;
  threadId: string;
}

export async function agentsFindRunOrigin(runId: string): Promise<AgentRunOrigin | null> {
  return invokeSafe('agents_find_run_origin', { runId });
}

export async function agentsBackfillThreadTitles(): Promise<number | null> {
  return invokeSafe('agents_backfill_thread_titles');
}

export async function agentsThreadsList(
  agentId: string,
): Promise<import('../../built-in-features/agents/types').ThreadDef[] | null> {
  return invokeSafe('agents_threads_list', { agentId });
}

export async function agentsMessageInsert(
  input: import('../../built-in-features/agents/types').MessageInsertInput,
): Promise<import('../../built-in-features/agents/types').MessageDef | null> {
  return invokeSafe('agents_message_insert', { input });
}

export async function agentsMessagesList(
  threadId: string,
): Promise<import('../../built-in-features/agents/types').MessageDef[] | null> {
  return invokeSafe('agents_messages_list', { threadId });
}

export async function agentsToolsRegisterTier2(
  extensionId: string,
  tools: import('asyar-sdk/contracts').ManifestTool[],
): Promise<void> {
  await invokeSafe('agents_tools_register_tier2', { extensionId, tools });
}

export async function agentsToolsUnregisterTier2(extensionId: string): Promise<void> {
  await invokeSafe('agents_tools_unregister_tier2', { extensionId });
}

export async function agentsToolsList(): Promise<
  import('asyar-sdk/contracts').ToolDescriptor[] | null
> {
  return invokeSafe('agents_tools_list');
}

export type AgentToolGroup =
  | { kind: 'builtin'; tools: import('asyar-sdk/contracts').ToolDescriptor[] }
  | {
      kind: 'tier2';
      extensionId: string;
      tools: import('asyar-sdk/contracts').ToolDescriptor[];
    }
  | {
      kind: 'mcp';
      serverId: string;
      tools: import('asyar-sdk/contracts').ToolDescriptor[];
    };

export interface AgentProviderOption {
  id: string;
  name: string;
}

export interface AgentEditorForm {
  name: string;
  description: string;
  systemPrompt: string;
  providerId: string;
  modelId: string;
  toolSelection: string[];
  silent: boolean;
  inputSource: import('../../built-in-features/agents/types').SilentInputSource;
  outputAction: import('../../built-in-features/agents/types').SilentOutputAction;
}

export interface AgentEditorViewModel {
  form: AgentEditorForm;
  providers: AgentProviderOption[];
  toolGroups: AgentToolGroup[];
}

export interface AgentEditorModelOptions {
  models: ModelInfo[];
  selectedModelId: string;
}

/** Strips an `IProviderPlugin` down to the wire shape Rust's availability policy needs. */
export function toAgentProviderDescriptors(
  providers: IProviderPlugin[],
): AgentProviderDescriptor[] {
  return providers.map(({ id, name, requiresApiKey, requiresBaseUrl }) => ({
    id,
    name,
    requiresApiKey,
    requiresBaseUrl,
  }));
}

export async function agentsEditorLoad(
  agentId: string | null,
  defaultAgentId: string | null,
  providers: IProviderPlugin[],
  configs: Record<ProviderId, ProviderConfig>,
): Promise<AgentEditorViewModel> {
  return invokeRaw('agents_editor_load', {
    agentId,
    defaultAgentId,
    providers: toAgentProviderDescriptors(providers),
    configs,
  });
}

export async function agentsEditorSave(
  agentId: string | null,
  form: AgentEditorForm,
): Promise<import('../../built-in-features/agents/types').AgentDef> {
  return invokeRaw('agents_editor_save', { agentId, form });
}

/**
 * Reason removing `providerId` should be blocked, or `null` when it's safe
 * (Rust decides via `agents_stranded_by_provider_removal` and formats the
 * message via `provider_removal_blocked_message`) — ready to display as-is.
 */
export async function agentsProviderRemovalBlockers(
  providerId: string,
  providers: IProviderPlugin[],
  configs: Record<ProviderId, ProviderConfig>,
): Promise<string | null> {
  return invokeRaw('agents_provider_removal_blockers', {
    providerId,
    providers: toAgentProviderDescriptors(providers),
    configs,
  });
}

export async function agentsEditorListModels(
  providerId: string,
  config: ProviderConfig,
  currentModelId: string,
): Promise<AgentEditorModelOptions> {
  const result = await invokeRaw<{
    models: ModelInfoContract[];
    selectedModelId: string;
  }>('agents_editor_list_models', { providerId, config, currentModelId });
  return {
    models: result.models.map((model) => ({
      id: model.id,
      label: model.label,
      reasoningEfforts: (model.reasoningEfforts as ReasoningEffort[] | null) ?? undefined,
    })),
    selectedModelId: result.selectedModelId,
  };
}

export async function agentsInvokeBuiltinTool(id: string, args: unknown): Promise<unknown | null> {
  return invokeSafe('agents_invoke_builtin_tool', { id, args });
}

export async function aiListModels(
  providerId: string,
  config: ProviderConfig,
): Promise<ModelInfo[]> {
  const models = await invokeRaw<ModelInfoContract[]>('ai_list_models', { providerId, config });
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    reasoningEfforts: (model.reasoningEfforts as ReasoningEffort[] | null) ?? undefined,
  }));
}
