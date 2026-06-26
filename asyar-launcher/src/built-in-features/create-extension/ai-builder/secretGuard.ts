import { scanExtensionForSecret } from '../../../lib/ipc/extensionBuilderCommands';

export type SecretScanResult = { leaked: false } | { leaked: true; path: string };

// Ask Rust to scan a built extension directory for a build-time secret that
// leaked into source. The scan runs in Rust because the build output lives at
// $HOME/AsyarExtensions/<id>, which the frontend Tauri fs allowlist does not
// cover. Fails closed: a non-empty secret found in any file returns `leaked`,
// and a scan that errors outright is also treated as `leaked` rather than
// silently passing — see `invokeSafeOption`'s `ok` flag.
export async function scanForSecret(path: string, secret: string): Promise<SecretScanResult> {
  if (secret.trim().length === 0) return { leaked: false };
  const result = await scanExtensionForSecret(path, secret);
  if (!result.ok) return { leaked: true, path };
  return result.value ? { leaked: true, path: result.value } : { leaked: false };
}
