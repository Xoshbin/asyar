import type { ThreadDef, MessageDef } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentService {
  listThreads(agentId: string): Promise<ThreadDef[]>;
  createThread(agentId: string, title?: string | null): Promise<ThreadDef>;
}

export interface SendMessageInput {
  agentId: string;
  threadId: string;
  userText: string;
}

export interface SendMessageDeps {
  runAgent: (input: { agentId: string; threadId: string; userText: string; abortSignal: AbortSignal }) => Promise<void>;
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
  const threads = await deps.service.listThreads(agentId);
  if (threads.length > 0) return threads[0];
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

export async function handleNewThread(
  agentId: string,
  deps: NewThreadDeps,
): Promise<ThreadDef> {
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

export function extractToolUsesFromMessage(
  msg: MessageDef,
): Array<{ id: string; name: string; input: unknown }> {
  if (msg.role !== 'assistant') return [];
  const toolUse = (msg.content as { toolUse?: Array<{ id: string; name: string; input: unknown }> }).toolUse;
  return toolUse ?? [];
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

// ── deriveThreadTitle ─────────────────────────────────────────────────────────

/**
 * Derive a thread title from the first user message. Mirrors OpenAI / Gemini
 * behavior of using the first user message as the thread label until a better
 * one is computed. Truncates at a word boundary to roughly 40 chars.
 */
export function deriveThreadTitle(userText: string): string {
  const collapsed = userText.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return 'New thread';
  const limit = 40;
  if (collapsed.length <= limit) return collapsed;
  const window = collapsed.slice(0, limit + 1);
  const lastSpace = window.lastIndexOf(' ');
  const cut = lastSpace > 20 ? lastSpace : limit;
  return collapsed.slice(0, cut).trimEnd() + '…';
}
