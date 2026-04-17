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
  // Same variables as BottomActionBar so the macOS bar matches the non-macOS
  // Svelte bar 1:1. `--text-secondary` covers both the label and the ↓ glyph.
  return {
    bar_bg: readVar('--bg-secondary-full-opacity'),
    border: readVar('--border-color'),
    text: readVar('--text-secondary'),
    chip_bg: readVar('--kbd-bg') || 'rgba(255, 255, 255, 0.08)',
    chip_border: readVar('--kbd-border') || 'rgba(255, 255, 255, 0.12)',
  };
}

export async function syncNativeBarStyle(): Promise<void> {
  if (!IS_MACOS) return;
  try {
    await updateShowMoreBarStyle(buildStyle());
  } catch (e) {
    logService.debug(`[nativeBarSync] updateShowMoreBarStyle failed: ${e}`);
  }
}

let started = false;

// Idempotent. Syncs now and on system dark/light changes. Theme-extension
// changes are re-synced from themeService.ts directly.
export function startNativeBarStyleSync(): void {
  if (started || !IS_MACOS) return;
  started = true;

  void syncNativeBarStyle();

  if (typeof window !== 'undefined' && window.matchMedia) {
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    dark.addEventListener?.('change', () => {
      requestAnimationFrame(() => void syncNativeBarStyle());
    });
  }
}
