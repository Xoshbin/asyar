import type { AgentCreateInput } from './types';

export const OOTB_DEFAULT_AGENT_SYSTEM_PROMPT =
  'You are Asyar Assistant, a friendly and helpful AI built into the Asyar launcher. ' +
  'Help the user with quick questions, explanations, drafting, summarizing, and general thinking-through. ' +
  "Be concise, accurate, and direct. If you don't know something, say so. " +
  'Use Markdown for code and lists when it improves clarity.';

export function buildDefaultAgentInput(providerId: string, modelId: string): AgentCreateInput {
  return {
    name: 'Asyar Assistant',
    description: 'Your built-in AI assistant. Editable from the Agents view.',
    systemPrompt: OOTB_DEFAULT_AGENT_SYSTEM_PROMPT,
    providerId,
    modelId,
    toolSelection: [],
  };
}

/**
 * The canonical example silent-AI command — "Grammar Fix". The user
 * selects text in any app, hits a hotkey bound to this agent's row,
 * and the launcher replaces the selection with the corrected text in
 * place. No window opens, no preview, no confirm. The reference UX
 * for the silent-AI command feature; doubles as a quick way to verify
 * the feature wired up end-to-end.
 *
 * Build this with `buildGrammarFixAgentInput(providerId, modelId)`
 * and pass to `agentService.create(...)`. Then bind a hotkey through
 * the existing item-shortcut UI (Cmd+K → Set Shortcut on the agent row).
 */
export const GRAMMAR_FIX_SYSTEM_PROMPT =
  'You are a grammar and style assistant. The user gives you a piece of text ' +
  'and you reply ONLY with the corrected version. Fix grammar, spelling, and ' +
  'awkward phrasing. Preserve the user’s original tone, voice, language, and ' +
  'formatting. Do not add preamble, commentary, or quotation marks — just the ' +
  'corrected text and nothing else.';

export function buildGrammarFixAgentInput(
  providerId: string,
  modelId: string,
): AgentCreateInput {
  return {
    name: 'Grammar Fix',
    description: 'Silent agent: replace selected text with the grammar-corrected version.',
    systemPrompt: GRAMMAR_FIX_SYSTEM_PROMPT,
    providerId,
    modelId,
    toolSelection: [],
    silent: true,
    inputSource: 'selection',
    outputAction: 'replaceSelection',
  };
}
