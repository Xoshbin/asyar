export type SidecarEvent =
  | { kind: 'verdict'; possible: boolean; reason: string; degradedNote?: string }
  | { kind: 'step'; label: string; detail?: string }
  | { kind: 'ask'; questionId: string; prompt: string; inputKind: 'text' | 'confirm' | 'secret'; placeholder?: string }
  | { kind: 'done'; extensionId: string; path: string; smokeSummary: string }
  | { kind: 'fail'; step: string; error: string; log: string };

export type BuilderCommand =
  | { kind: 'answer'; questionId: string; value: string }
  | { kind: 'cancel' };

export function emit(ev: SidecarEvent): void {
  process.stdout.write(JSON.stringify(ev) + '\n');
}
