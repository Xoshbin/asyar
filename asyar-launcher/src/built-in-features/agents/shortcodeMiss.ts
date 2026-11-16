export interface ShortcodeMissAgentCandidate {
  id: string;
  inputSource?: string;
  shortcodeTrigger?: string;
}

export interface ResolvedShortcodeMiss<T extends ShortcodeMissAgentCandidate> {
  agent: T;
  trigger: string;
  userText: string;
}

export function resolveShortcodeMissAgent<T extends ShortcodeMissAgentCandidate>(
  agents: readonly T[],
  rawShortcode: string,
): ResolvedShortcodeMiss<T> | null {
  const trimmed = rawShortcode.trim();
  const matching = agents
    .filter((a) => {
      if (a.inputSource !== 'shortcodeMiss') return false;
      const trigger = a.shortcodeTrigger?.trim();
      if (!trigger) return false;
      return trimmed.startsWith(trigger) && trimmed.endsWith(trigger);
    })
    .sort(
      (a, b) => (b.shortcodeTrigger?.trim().length ?? 0) - (a.shortcodeTrigger?.trim().length ?? 0),
    );

  const agent = matching[0];
  if (!agent) return null;

  const trigger = agent.shortcodeTrigger!.trim();
  let userText = trimmed;
  if (userText.startsWith(trigger) && userText.endsWith(trigger)) {
    userText = userText.slice(trigger.length, -trigger.length);
  } else {
    userText = userText.replaceAll(trigger, '');
  }

  return { agent, trigger, userText };
}
