import type { DiagnosticKind } from './kinds';

export type DiagnosticMessageTemplate = (ctx: Record<string, string>) => string;

export type DiagnosticMessages = Record<DiagnosticKind, DiagnosticMessageTemplate>;

/**
 * Typed identity function. Forces the registry to cover every
 * DiagnosticKind exhaustively — adding a new kind to kinds.ts (via the
 * Rust generator) creates a TS compile error here until the message is
 * registered. Mirrors defineServiceRegistry from the architectural-integrity
 * skill.
 */
export function defineDiagnosticMessages(reg: DiagnosticMessages): DiagnosticMessages {
  return reg;
}
