import { invokeSafe, invokeSafeVoid, invokeSafeOption } from './invokeSafe';

export interface CreatedExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string | null;
  path: string;
}

// `ext_builder_*` are all `Result<(), String>` on the Rust side — use
// invokeSafeVoid's boolean signal, not invokeSafe's ambiguous null.

export async function extBuilderStart(opts: {
  prompt: string;
  targetDir: string;
  capabilitySpecDir: string;
  anthropicKey: string;
}): Promise<boolean> {
  return invokeSafeVoid('ext_builder_start', {
    prompt: opts.prompt,
    targetDir: opts.targetDir,
    capabilitySpecDir: opts.capabilitySpecDir,
    anthropicKey: opts.anthropicKey,
  });
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
