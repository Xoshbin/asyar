import { platform } from '@tauri-apps/plugin-os';
import { updateShowMoreBarStyle, type ShowMoreBarStyle } from '../../lib/ipc/commands';
import { logService } from '../log/logService';

// Theme-color sync for the native macOS Show More bar. Non-macOS is a no-op
// — the Svelte fallback bar inherits CSS vars naturally.

const IS_MACOS = (() => {
  try { return platform() === 'macos'; } catch { return false; }
})();

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildStyle(): ShowMoreBarStyle {
  // Mirror KeyboardHint.svelte's kbd so the native macOS chip matches the
  // in-webview chip. `--text-secondary` covers both the label and the ↓ glyph.
  return {
    bar_bg: readVar('--bg-secondary-full-opacity'),
    text: readVar('--text-secondary'),
    chip_bg: readVar('--bg-selected'),
    chip_border: readVar('--kbd-rim'),
  };
}

// Idempotent. Callers re-sync after each event that may have changed CSS
// vars: theme preference flips (themeMode), theme-extension apply/remove
// (themeService), and first paint (compactSyncService.onMount).
export async function syncNativeBarStyle(): Promise<void> {
  if (!IS_MACOS) return;
  try {
    await updateShowMoreBarStyle(buildStyle());
  } catch (e) {
    logService.debug(`[nativeBarSync] updateShowMoreBarStyle failed: ${e}`);
  }
}
