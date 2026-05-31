import { invoke } from '@tauri-apps/api/core';

export type SecretScanResult = { leaked: false } | { leaked: true; path: string };

// Ask Rust to scan a built extension directory for a build-time secret that
// leaked into source. The scan runs in Rust because the build output lives at
// $HOME/AsyarExtensions/<id>, which the frontend Tauri fs allowlist does not
// cover. Fails closed: a non-empty secret found in any file returns `leaked`.
export async function scanForSecret(path: string, secret: string): Promise<SecretScanResult> {
  if (secret.trim().length === 0) return { leaked: false };
  const offending = await invoke<string | null>('scan_extension_for_secret', { path, secret });
  return offending ? { leaked: true, path: offending } : { leaked: false };
}
