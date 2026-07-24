// asyar-launcher/src/lib/ipc/systemActionCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid, invokeRaw } from './invokeSafe';
import type { ProviderConfig } from '../../services/ai/IProviderPlugin';
import type { AgentRunConfig as AgentRunConfigContract, SystemAction } from '../../bindings';

// ── System actions ────────────────────────────────────────────────────────────

/** Generated from Rust's `SystemAction` enum — see `../../bindings`. */
export type SystemActionId = SystemAction;

/** Actions the current machine supports, in display order. */
export async function systemActionsSupported(): Promise<SystemActionId[]> {
  return (await invokeSafe<SystemActionId[]>('system_actions_supported')) ?? [];
}

export async function systemActionRun(action: SystemActionId): Promise<boolean> {
  return invokeSafeVoid('system_action_run', { action });
}

export interface AgentRunConfig extends Omit<AgentRunConfigContract, 'configs'> {
  configs: Record<string, ProviderConfig>;
}

export async function agentsRunThread(
  agentId: string,
  threadId: string,
  userText: string,
  runId: string | null,
  config: AgentRunConfig,
  streamId: string,
): Promise<void> {
  await invokeRaw('agents_run_thread', { agentId, threadId, userText, runId, config, streamId });
}

export async function agentsRunSilent(
  agentId: string,
  userText: string,
  config: AgentRunConfig,
  streamId: string,
): Promise<string> {
  return invokeRaw<string>('agents_run_silent', {
    agentId,
    userText,
    config,
    streamId,
  });
}

export async function agentsResolveDefault(
  defaultAgentId: string | null,
): Promise<import('../../built-in-features/agents/types').AgentDef | null> {
  return invokeRaw<import('../../built-in-features/agents/types').AgentDef | null>(
    'agents_resolve_default',
    { defaultAgentId },
  );
}

export async function agentsUpsertDefault(
  defaultAgentId: string | null,
  providerId: string,
  modelId: string,
): Promise<import('../../built-in-features/agents/types').AgentDef> {
  return invokeRaw<import('../../built-in-features/agents/types').AgentDef>(
    'agents_upsert_default',
    { defaultAgentId, providerId, modelId },
  );
}

export async function agentsSeedGrammarFix(
  providerId: string,
  modelId: string,
): Promise<import('../../built-in-features/agents/types').AgentDef> {
  return invokeRaw<import('../../built-in-features/agents/types').AgentDef>(
    'agents_seed_grammar_fix',
    { providerId, modelId },
  );
}

export async function agentsSeedEmojiFallback(
  providerId: string,
  modelId: string,
): Promise<import('../../built-in-features/agents/types').AgentDef> {
  return invokeRaw<import('../../built-in-features/agents/types').AgentDef>(
    'agents_seed_emoji_fallback',
    { providerId, modelId },
  );
}

export async function agentsReportToolResult(
  streamId: string,
  toolCallId: string,
  result: unknown,
  error?: string,
): Promise<void> {
  await invokeRaw('agents_report_tool_result', {
    streamId,
    toolCallId,
    result,
    error: error ?? null,
  });
}

export type McpPermissionChoice = 'allow_once' | 'allow_always' | 'never' | 'cancel';

export async function agentsReportMcpPermission(
  streamId: string,
  toolCallId: string,
  decision: McpPermissionChoice,
): Promise<void> {
  await invokeRaw('agents_report_mcp_permission', { streamId, toolCallId, decision });
}

export async function agentsCancelRun(streamId: string): Promise<void> {
  await invokeRaw('agents_cancel_run', { streamId });
}

export async function agentsListCached(agentId: string): Promise<[string, string][]> {
  return invokeRaw<[string, string][]>('agents_list_cached', { agentId });
}

export async function agentsForgetCached(agentId: string, input: string): Promise<void> {
  await invokeRaw('agents_forget_cached', { agentId, input });
}

export async function agentsClearCached(agentId: string): Promise<void> {
  await invokeRaw('agents_clear_cached', { agentId });
}

export async function agentsPromoteCached(agentId: string, input: string): Promise<void> {
  await invokeRaw('agents_promote_cached', { agentId, input });
}
