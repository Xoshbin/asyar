import { invokeSafe, invokeSafeVoid, invokeSafeOption } from './invokeSafe';

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
// invokeSafeVoid's boolean signal. `ext_builder_start` returns a real
// payload, so it uses `invokeSafe` (null on error) instead.

export async function extBuilderStart(opts: {
  prompt: string;
  targetDir: string;
  capabilitySpecDir: string;
  anthropicKey: string;
}): Promise<ExtBuilderStartResult | null> {
  return invokeSafe<ExtBuilderStartResult>('ext_builder_start', {
    prompt: opts.prompt,
    targetDir: opts.targetDir,
    capabilitySpecDir: opts.capabilitySpecDir,
    anthropicKey: opts.anthropicKey,
  });
}

export async function extBuilderCheckRuntimes(): Promise<MissingRuntime[] | null> {
  return invokeSafe<MissingRuntime[]>('ext_builder_check_runtimes');
}

export async function extBuilderAnswer(line: string): Promise<boolean> {
  return invokeSafeVoid('ext_builder_answer', { line });
}

export async function extBuilderCancel(): Promise<boolean> {
  return invokeSafeVoid('ext_builder_cancel');
}

export async function listCreatedExtensions(): Promise<CreatedExtension[] | null> {
  return invokeSafe<CreatedExtension[]>('list_created_extensions');
}

export async function searchCreatedExtensions(query: string): Promise<CreatedExtension[] | null> {
  return invokeSafe<CreatedExtension[]>('search_created_extensions', { query });
}

/**
 * `scan_extension_for_secret` is `Result<Option<String>, AppError>` — a
 * clean scan (`Ok(None)`) and a failed scan both serialize to `null`. The
 * secret guard fails closed, so the caller needs the explicit `ok` flag
 * to tell "no secret found" apart from "the scan itself errored" — see
 * `invokeSafeOption`.
 */
export async function scanExtensionForSecret(
  path: string,
  secret: string,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  return invokeSafeOption<string>('scan_extension_for_secret', { path, secret });
}
