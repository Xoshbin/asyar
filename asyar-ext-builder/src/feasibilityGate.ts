export interface Capabilities { permissions: string[]; cannot: string[] }
export interface Verdict { possible: boolean; reason: string; degradedNote?: string }

export function buildGatePrompt(request: string, caps: Capabilities): string {
  return [
    'You decide whether an Asyar Tier-2 extension can satisfy a user request.',
    'ALLOWED permissions:', caps.permissions.join(', '),
    'HARD LIMITS (instant no):', caps.cannot.join(' '),
    `User request: """${request}"""`,
    'Reply with ONLY a JSON object: {"possible": boolean, "reason": string}.',
    'If impossible, reason must name the missing capability and suggest the nearest feasible alternative.',
  ].join('\n');
}

export function parseVerdict(raw: string): Verdict {
  const match = raw.match(/\{[^{}]*"possible"[\s\S]*?\}/);
  if (!match) return { possible: false, reason: 'Could not determine feasibility; refusing to guess.' };
  try {
    const obj = JSON.parse(match[0]);
    return { possible: Boolean(obj.possible), reason: String(obj.reason ?? '') };
  } catch {
    return { possible: false, reason: 'Could not determine feasibility; refusing to guess.' };
  }
}
