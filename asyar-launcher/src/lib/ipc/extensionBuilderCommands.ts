import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export interface CreatedExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string | null;
  path: string;
}

export interface MissingRuntime {
  name: string;
  sizeBytes: number;
}

export type ExtBuilderStartResult =
  { status: 'started' } | { status: 'needsRuntimes'; runtimes: MissingRuntime[] };

// `ext_builder_answer`/`ext_builder_cancel` are `Result<(), String>` — use
// invokeSafeVoid's true-or-reject contract. `ext_builder_start` returns a
// real payload, so it uses `invokeSafe` directly.

export async function extBuilderStart(opts: {
  prompt: string;
  targetDir: string;
  capabilitySpecDir: string;
  anthropicKey: string;
}): Promise<ExtBuilderStartResult> {
  return invokeSafe<ExtBuilderStartResult>('ext_builder_start', {
    prompt: opts.prompt,
    targetDir: opts.targetDir,
    capabilitySpecDir: opts.capabilitySpecDir,
    anthropicKey: opts.anthropicKey,
  });
}

export async function extBuilderCheckRuntimes(): Promise<MissingRuntime[]> {
  return invokeSafe<MissingRuntime[]>('ext_builder_check_runtimes');
}

export async function extBuilderAnswer(line: string): Promise<boolean> {
  return invokeSafeVoid('ext_builder_answer', { line });
}

export async function extBuilderCancel(): Promise<boolean> {
  return invokeSafeVoid('ext_builder_cancel');
}

export async function listCreatedExtensions(): Promise<CreatedExtension[]> {
  return invokeSafe<CreatedExtension[]>('list_created_extensions');
}

export async function searchCreatedExtensions(query: string): Promise<CreatedExtension[]> {
  return invokeSafe<CreatedExtension[]>('search_created_extensions', { query });
}

/**
 * `scan_extension_for_secret` is `Result<Option<String>, AppError>` — a
 * clean scan (`Ok(None)`) serializes to `null`, while failures reject with
 * `IpcError`. The secret guard catches that rejection and fails closed.
 */
export async function scanExtensionForSecret(path: string, secret: string): Promise<string | null> {
  return invokeSafe<string | null>('scan_extension_for_secret', { path, secret });
}
