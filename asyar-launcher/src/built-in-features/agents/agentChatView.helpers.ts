import type { AgentDef, ThreadDef, MessageDef } from './types';
import type { GeminiGrounding, GroundingSource } from '../../bindings';
import type { ProviderConfig, ToolCall } from '../../services/ai/IProviderPlugin';
import { externalSearchUrl } from '../../components/ai/googleSearchSuggestions';
import { t } from '../../services/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentService {
  createThread(agentId: string, title?: string | null): Promise<ThreadDef>;
}

export interface SendMessageInput {
  agentId: string;
  threadId: string;
  userText: string;
}

export interface SendMessageDeps {
  runAgent: (input: {
    agentId: string;
    threadId: string;
    userText: string;
    abortSignal: AbortSignal;
  }) => Promise<void>;
  refreshMessages: () => Promise<void>;
  currentAbortController: AbortController;
}

export interface NewThreadDeps {
  service: AgentService;
  refreshThreadsAndSelect: (thread: ThreadDef) => void | Promise<void>;
}

export interface EnsureThreadDeps {
  service: AgentService;
}

// ── ensureThread ──────────────────────────────────────────────────────────────

export async function ensureThread(agentId: string, deps: EnsureThreadDeps): Promise<ThreadDef> {
  return deps.service.createThread(agentId, '');
}

// ── handleSendMessage ─────────────────────────────────────────────────────────

export async function handleSendMessage(
  input: SendMessageInput,
  deps: SendMessageDeps,
): Promise<void> {
  try {
    await deps.runAgent({
      agentId: input.agentId,
      threadId: input.threadId,
      userText: input.userText,
      abortSignal: deps.currentAbortController.signal,
    });
  } finally {
    await deps.refreshMessages();
  }
}

// ── handleNewThread ───────────────────────────────────────────────────────────

export async function handleNewThread(agentId: string, deps: NewThreadDeps): Promise<ThreadDef> {
  const thread = await deps.service.createThread(agentId, '');
  await deps.refreshThreadsAndSelect(thread);
  return thread;
}

// ── extractTextFromMessage ────────────────────────────────────────────────────

export function extractTextFromMessage(msg: MessageDef): string {
  if (msg.role === 'tool') {
    const tr = (msg.content as { toolResult?: { output: unknown } }).toolResult;
    return tr ? JSON.stringify(tr.output) : '';
  }
  const text = (msg.content as { text?: string }).text;
  return text ?? '';
}

// ── extractToolUsesFromMessage ────────────────────────────────────────────────

export function extractToolUsesFromMessage(msg: MessageDef): ToolCall[] {
  if (msg.role !== 'assistant') return [];
  const toolUse = (msg.content as { toolUse?: ToolCall[] }).toolUse;
  return toolUse ?? [];
}

// ── lastAssistantMessageText ──────────────────────────────────────────────────

/** Text of the most recent assistant message, or null if there is none yet. */
export function lastAssistantMessageText(messages: MessageDef[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return extractTextFromMessage(messages[i]);
  }
  return null;
}

// ── messageBubbleVariant ──────────────────────────────────────────────────────

export function messageBubbleVariant(msg: MessageDef): 'user' | 'assistant' | 'tool' {
  return msg.role;
}

// ── handleCancelSend ──────────────────────────────────────────────────────────

export interface CancelSendOpts {
  abortController: AbortController | null;
}

export function handleCancelSend(opts: CancelSendOpts): void {
  opts.abortController?.abort();
}

// ── resolveThreadId ───────────────────────────────────────────────────────────

export function resolveThreadId(
  currentThreadId: string | null,
  threads: { id: string }[],
): string | null {
  if (!currentThreadId) return null;
  return threads.some((t) => t.id === currentThreadId) ? currentThreadId : null;
}

/** Rust prepares safe source URLs; this only reads the saved presentation. */
export function extractGroundingFromMessage(msg: MessageDef): GeminiGrounding[] {
  if (msg.role !== 'assistant') return [];
  const context = (
    msg.content as {
      providerContext?: { geminiGroundingDisplay?: GeminiGrounding }[];
    }
  ).providerContext;
  return (
    context?.flatMap((item) =>
      item.geminiGroundingDisplay ? [item.geminiGroundingDisplay] : [],
    ) ?? []
  );
}

function parseRawSources(raw: unknown): GroundingSource[] {
  if (!Array.isArray(raw)) return [];
  const valid: GroundingSource[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const rawUrl = typeof rec.url === 'string' ? rec.url.trim() : '';
    const safeUrl = externalSearchUrl(rawUrl);
    if (title.length > 0 && safeUrl) {
      valid.push({ title, url: safeUrl });
    }
  }
  return valid;
}

function extractDirectSources(msg: MessageDef): GroundingSource[] {
  const sources: GroundingSource[] = [];

  if (msg.role === 'tool') {
    const tr = (msg.content as { toolResult?: { output: unknown } })?.toolResult;
    let output = tr?.output;
    if (typeof output === 'string') {
      try {
        output = JSON.parse(output);
      } catch {
        // Raw string output, not JSON
      }
    }
    if (typeof output === 'object' && output !== null) {
      sources.push(...parseRawSources((output as { sources?: unknown }).sources));
    }
  } else if (msg.role === 'assistant') {
    const content = msg.content as {
      providerContext?: Array<{
        webSearchGroundingDisplay?: { sources?: unknown };
        geminiGroundingDisplay?: { sources?: unknown };
      }>;
      sources?: unknown;
    };
    if (Array.isArray(content?.providerContext)) {
      for (const item of content.providerContext) {
        if (item.webSearchGroundingDisplay?.sources) {
          sources.push(...parseRawSources(item.webSearchGroundingDisplay.sources));
        }
        if (item.geminiGroundingDisplay?.sources) {
          sources.push(...parseRawSources(item.geminiGroundingDisplay.sources));
        }
      }
    }
    if (content?.sources) {
      sources.push(...parseRawSources(content.sources));
    }
  }

  return sources;
}

function deduplicateSources(sources: GroundingSource[]): GroundingSource[] {
  const seen = new Set<string>();
  const deduped: GroundingSource[] = [];
  for (const s of sources) {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      deduped.push(s);
    }
  }
  return deduped;
}

/**
 * Aggregates sources from:
 * 1. Vendor-hosted grounding (providerContext[].webSearchGroundingDisplay / geminiGroundingDisplay)
 * 2. Tool execution outputs that conform to { sources: [{ title, url }] }
 * 3. Preceding tool messages within the same assistant turn when rendering assistant answers.
 */
export function extractSourcesFromMessage(
  msg: MessageDef,
  threadMessages?: MessageDef[],
): GroundingSource[] {
  const direct = extractDirectSources(msg);
  if (direct.length > 0) {
    return deduplicateSources(direct);
  }

  if (msg.role === 'assistant' && threadMessages && threadMessages.length > 0) {
    const msgIndex = threadMessages.findIndex((m) => m.id === msg.id);
    if (msgIndex > 0) {
      const turnSources: GroundingSource[] = [];
      for (let i = msgIndex - 1; i >= 0; i--) {
        const prev = threadMessages[i];
        if (prev.role === 'user') break;
        if (prev.role === 'tool') {
          turnSources.unshift(...extractDirectSources(prev));
        }
      }
      if (turnSources.length > 0) {
        return deduplicateSources(turnSources);
      }
    }
  }

  return [];
}

type ProviderPlugins = Array<{ id: string; name: string }>;

/** A provider's display name, as the AI settings rows label it. */
export function providerLabel(
  providerId: string,
  providers: Record<string, ProviderConfig>,
  plugins: ProviderPlugins,
): string {
  const config = providers[providerId];
  return (
    config?.name ??
    plugins.find((p) => p.id === (config?.providerType ?? providerId))?.name ??
    providerId
  );
}

/**
 * Options for the chat view's ⌘P agent switcher. Silent agents are left out:
 * they run headlessly and never open a chat.
 */
export function agentSwitcherOptions(
  agents: Array<Pick<AgentDef, 'id' | 'name' | 'silent'>>,
): Array<{ value: string; title: string }> {
  return agents.filter((a) => !a.silent).map((a) => ({ value: a.id, title: a.name }));
}

/**
 * The provider and model a thread's next run uses: its override when it has
 * one, otherwise its agent's. Mirrors `resolve_thread_agent` in Rust, minus
 * the usability fallback, which only the run can judge.
 */
export function threadRunTarget(
  agent: Pick<AgentDef, 'providerId' | 'modelId'>,
  thread: Pick<ThreadDef, 'providerId' | 'modelId'> | null | undefined,
): { providerId: string; modelId: string } {
  if (thread?.providerId && thread.modelId) {
    return { providerId: thread.providerId, modelId: thread.modelId };
  }
  return { providerId: agent.providerId, modelId: agent.modelId };
}

/** Bottom-bar subtitle for the chat view: who you are talking to, on what. */
export function chatSubtitle(
  agent: Pick<AgentDef, 'name' | 'providerId' | 'modelId'>,
  providers: Record<string, ProviderConfig>,
  plugins: ProviderPlugins,
): string {
  const parts = [agent.name, providerLabel(agent.providerId, providers, plugins)];
  if (agent.modelId) parts.push(agent.modelId);
  return parts.join(' · ');
}

/** Returns true if the normalized engine corresponds to Google Antigravity (agy). */
export function isAgyEngine(engine: string): boolean {
  const normalized = engine.toLowerCase();
  return normalized === 'google' || normalized === 'agy' || normalized.includes('antigravity');
}

/**
 * Formats user-facing notice text when tools are dropped for an agent run
 * using a CLI-mode provider.
 */
export function formatToolsUnavailableNotice(engine: string, tools: string[]): string {
  const toolsList = tools.join(', ');
  if (isAgyEngine(engine)) {
    return t('features.agents.tools_unavailable_agy', { tools: toolsList });
  }
  const normalized = engine.toLowerCase();
  const name = normalized === 'openai' || normalized.includes('codex') ? 'Codex' : 'Claude Code';
  return t('features.agents.tools_unavailable_cli', { engine: name, tools: toolsList });
}

/**
 * Formats user-facing explanation in the agent editor when selected tools are
 * dropped because the active provider is running in CLI mode.
 */
export function formatEditorToolsUnavailableWarning(engine: string): string {
  return t(
    isAgyEngine(engine)
      ? 'features.agents.edit.tools_dropped_agy'
      : 'features.agents.edit.tools_dropped_cli',
  );
}
