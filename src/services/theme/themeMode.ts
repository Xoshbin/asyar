import { syncNativeBarStyle } from './nativeBarSync';
import { setPanelAppearance } from '../../lib/ipc/commands';
import { logService } from '../log/logService';

// Resolves preference → <html data-theme>; under "system", a matchMedia
// listener re-resolves so OS appearance toggles retint without a relaunch.

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

let currentPreference: ThemePreference = 'system';
let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function write(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.theme === resolved) return;
  document.documentElement.dataset.theme = resolved;
  // rAF lets the style commit so getComputedStyle reads the new values.
  requestAnimationFrame(() => void syncNativeBarStyle());
  // Keep NSVisualEffectView material in sync. Pass the preference so Rust
  // re-resolves "system" the same way the OS-notification observer does.
  setPanelAppearance(currentPreference).catch((e) => {
    logService.debug(`[themeMode] setPanelAppearance failed: ${e}`);
  });
}

export function applyThemePreference(pref: ThemePreference): void {
  currentPreference = pref;
  write(resolve(pref));

  if (typeof window === 'undefined' || !window.matchMedia) return;
  if (pref === 'system') {
    if (!mediaQuery) mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (!mediaListener) {
      mediaListener = () => {
        if (currentPreference === 'system') write(resolve('system'));
      };
      mediaQuery.addEventListener?.('change', mediaListener);
    }
  } else if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener?.('change', mediaListener);
    mediaListener = null;
  }
}
