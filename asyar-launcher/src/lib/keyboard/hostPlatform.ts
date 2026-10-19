import { platform } from '@tauri-apps/plugin-os';

export type HostPlatform = 'macos' | 'windows' | 'other';

let cached: HostPlatform | null = null;

/**
 * The OS the launcher is running on, collapsed to what shortcut handling
 * cares about. Resolved once: `platform()` reads a value Tauri injects at
 * window creation, so it cannot change for the life of the process.
 * Outside Tauri (unit tests, Storybook) it falls back to the user agent.
 */
export function getHostPlatform(): HostPlatform {
  if (cached) return cached;
  let resolved: HostPlatform;
  try {
    const p = platform();
    resolved = p === 'macos' ? 'macos' : p === 'windows' ? 'windows' : 'other';
  } catch {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    resolved = /Mac/i.test(ua) ? 'macos' : /Win/i.test(ua) ? 'windows' : 'other';
  }
  cached = resolved;
  return resolved;
}
