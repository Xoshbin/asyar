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
