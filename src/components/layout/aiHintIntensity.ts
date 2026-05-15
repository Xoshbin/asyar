// Heuristic for the AI hint chip's visual tier — passive (muted) vs active (styled).

const AI_INTENT_STARTERS = [
  'why', 'how', 'what', 'explain', 'describe', 'summarize',
  'write', 'generate', 'translate', 'ask',
];

/**
 * Returns true when the search text looks like an AI-directed question,
 * meaning the chip should be rendered with a stronger visual treatment
 * (e.g. brighter icon, label always visible).
 */
export function looksLikeAIIntent(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  const words = trimmed.split(/\s+/);
  if (words.length >= 3) return true;
  if (words.length >= 2) {
    const firstWord = words[0].toLowerCase();
    if (AI_INTENT_STARTERS.includes(firstWord)) return true;
  }
  return false;
}
