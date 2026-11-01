import { hostname } from '@tauri-apps/plugin-os';

/**
 * Returns the local machine's hostname or a sensible fallback for pairing requests.
 */
export async function getDeviceName(): Promise<string> {
  try {
    const name = await hostname();
    if (typeof name === 'string' && name.trim().length > 0) {
      return name.trim();
    }
  } catch {
    // Non-fatal: fallback to default if OS plugin fails
  }
  return 'Asyar Device';
}
