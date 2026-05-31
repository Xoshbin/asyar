// Outbound: sidecar -> launcher
export type SidecarEvent =
  | { kind: 'verdict'; possible: boolean; reason: string; degradedNote?: string }
  | { kind: 'step'; label: string; detail?: string }
  | { kind: 'ask'; questionId: string; prompt: string; inputKind: 'text' | 'confirm' | 'secret'; placeholder?: string }
  | { kind: 'done'; extensionId: string; path: string; smokeSummary: string }
  | { kind: 'fail'; step: string; error: string; log: string };

// Inbound: launcher -> sidecar
export type BuilderCommand =
  | { kind: 'answer'; questionId: string; value: string }
  | { kind: 'cancel' };

// keep in sync with SidecarEvent
const SIDECAR_KINDS = new Set(['verdict', 'step', 'ask', 'done', 'fail']);

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function hasValidFields(kind: string, o: Record<string, unknown>): boolean {
  switch (kind) {
    case 'verdict':
      return typeof o.possible === 'boolean' && isString(o.reason);
    case 'step':
      return isString(o.label);
    case 'ask':
      return (
        isString(o.questionId) &&
        isString(o.prompt) &&
        (o.inputKind === 'text' || o.inputKind === 'confirm' || o.inputKind === 'secret')
      );
    case 'done':
      return isString(o.extensionId) && isString(o.path) && isString(o.smokeSummary);
    case 'fail':
      return isString(o.step) && isString(o.error) && isString(o.log);
    default:
      return false;
  }
}

export function parseSidecarEvent(line: string): SidecarEvent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !SIDECAR_KINDS.has(kind)) return null;
  if (!hasValidFields(kind, o)) return null;
  return obj as SidecarEvent;
}

export function serializeBuilderCommand(cmd: BuilderCommand): string {
  return JSON.stringify(cmd);
}
