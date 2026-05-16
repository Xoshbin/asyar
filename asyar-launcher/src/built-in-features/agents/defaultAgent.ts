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
/*
 * Few-shot system prompt. Negative instructions ("don't explain", "no quotes")
 * are silently ignored by smaller / faster models (Haiku, Gemini Flash, GPT
 * mini) — exactly the models people pick for a fast grammar fix. Concrete
 * input→output examples teach length, format, and the "no preamble" rule
 * far more reliably than telling the model what to avoid. We also frame the
 * agent as a *rewriter* (function) rather than an *assistant* (tutor) to
 * pull it out of "explain things" mode.
 *
 * The fourth example (already-correct input → unchanged output) is deliberate:
 * without it, models tend to invent an "improvement" rather than admit the
 * input was fine.
 */
export const GRAMMAR_FIX_SYSTEM_PROMPT = [
  'You rewrite English text with corrected grammar, spelling, and phrasing.',
  "Preserve the original tone, voice, language, register, and formatting.",
  '',
  'Output rules:',
  '- Output the corrected text only. Match the input\'s length — a short',
  '  input gets a short output, a long input gets a long output.',
  '- No preamble. No explanation. No alternatives. No quotation marks',
  '  around the output. No "Here is..." or "Sure, ...".',
  '- If the input is already correct, output it unchanged.',
  '',
  'Examples:',
  '',
  'Input: the cat sit on mat',
  'Output: The cat sits on the mat.',
  '',
  'Input: i recieved you\'re message yesterday and ill respond asap',
  "Output: I received your message yesterday and I'll respond ASAP.",
  '',
  'Input: We was going too the store wen it started raining',
  'Output: We were going to the store when it started raining.',
  '',
  'Input: This is a perfectly fine sentence already.',
  'Output: This is a perfectly fine sentence already.',
  '',
  "Now correct the user's next message the same way.",
].join('\n');

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

/**
 * Default hotkey pre-filled in the onboarding "Pick AI command shortcut"
 * step and bound automatically when the user clicks Continue. Used both
 * for first-install seeding and for the implicit seed when AI is set up
 * via the Settings tab outside of onboarding.
 *
 * **Choice:** `Super+Shift+L` — renders as ⌘⇧L on macOS, ⊞⇧L on Windows,
 * Super+Shift+L on Linux. The frontend display layer maps `Super` to the
 * platform's "OS" key icon via `shortcutFormatter.modifierSymbol`.
 *
 * Why this combo:
 *  - Familiar to Raycast users — Raycast uses ⌘⇧L for "Ask AI" so the
 *    muscle memory transfers.
 *  - Low collision with system shortcuts. `Cmd+L` jumps to the address
 *    bar in browsers but adding Shift takes it out of that path.
 *  - The user picks their own at onboarding time; this is just the
 *    pre-fill they see.
 *
 * Modifier MUST be one of the tokens the Rust `canonicalize_shortcut`
 * accepts: `Control` / `Ctrl` / `Alt` / `Shift` / `Super`. Using `Cmd`
 * here would cause the Tauri `register_item_shortcut` call to error out
 * with "Invalid modifier: Cmd" — silently failing the seed because the
 * onboarding step only surfaces a generic diagnostic toast.
 */
export const DEFAULT_GRAMMAR_FIX_HOTKEY: { modifier: string; key: string } = {
  modifier: 'Super+Shift',
  key: 'L',
};
