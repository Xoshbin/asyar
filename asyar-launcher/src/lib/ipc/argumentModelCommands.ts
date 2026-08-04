import type { CommandArgument } from 'asyar-sdk/contracts';
import { invokeRaw } from './invokeSafe';

/** Mirrors `extensions::argument_model::ResolveArgumentModelRequest` in Rust. */
export interface ResolveArgumentModelRequest {
  args: CommandArgument[];
  persisted?: Record<string, string>;
  values: Record<string, string>;
  edited?: string[];
  confirmed?: string[];
  requireAnyOf?: string[];
}

/** Mirrors `extensions::argument_model::ArgumentModelResolution` in Rust. */
export interface ArgumentModelResolution {
  seeds: Record<string, string>;
  seededFromUser: string[];
  /** Names of args whose effective seed is `lastUsed` — the only ones a
   *  submitted value should ever be persisted for. */
  lastUsedFields: string[];
  userSupplied: Record<string, string>;
  acknowledged: Record<string, string>;
  unfilledRequiredVisible: string[];
  unfilledRequired: string[];
  unfilledRequiredAcknowledged: string[];
  requireAnyOfUnsatisfied: boolean;
  payload: Record<string, string | number>;
}

/**
 * Resolve seeding, provenance, the `required`/`requireAnyOf` gates, and the
 * coerced execution payload for a command's declared arguments. Stateless
 * and pure on the Rust side — a rejection is a genuine IPC/serialization
 * failure, not a business-rule refusal, so this uses `invokeRaw` and leaves
 * handling to the caller (see `commandArgumentsService`).
 */
export async function resolveCommandArguments(
  request: ResolveArgumentModelRequest,
): Promise<ArgumentModelResolution> {
  return invokeRaw<ArgumentModelResolution>('resolve_command_arguments', { request });
}
