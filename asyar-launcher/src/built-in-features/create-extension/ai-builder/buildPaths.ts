import { resolveResource } from '@tauri-apps/api/path';

export async function resolveCapabilitySpecDir(): Promise<string> {
  // Bundled at src-tauri/resources/capabilitySpec (staged by build.rs, declared in tauri.conf.json).
  return resolveResource('resources/capabilitySpec');
}
