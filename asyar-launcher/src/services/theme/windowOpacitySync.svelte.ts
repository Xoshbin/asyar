import { emit } from '@tauri-apps/api/event';
import { settingsService } from '../settings/settingsService.svelte';
import { setWindowGlass } from '../../lib/ipc/windowCommands';
import { getHostPlatform } from '../../lib/keyboard/hostPlatform';
import {
  WINDOW_OPACITY_EVENT,
  WINDOW_OPACITY_RANGE,
  resolveWindowOpacity,
} from '../../lib/launcher/windowOpacity';
import { logService } from '../log/logService';

let unsubscribe: (() => void) | null = null;
let lastOpacity: number | null = null;

/**
 * Follows Window opacity from the launcher: turns the native blur off when
 * surfaces are solid, and tells the HUD, which has no settings access.
 */
export function initWindowOpacitySync(): () => void {
  unsubscribe?.();
  lastOpacity = null;
  unsubscribe = settingsService.subscribe((settings) => {
    const opacity = resolveWindowOpacity(settings.appearance, getHostPlatform());
    if (opacity === lastOpacity) return;
    // The blur is on from window setup, so only a change of solid-ness needs native work.
    const wasSolid = lastOpacity === WINDOW_OPACITY_RANGE.max;
    const isSolid = opacity === WINDOW_OPACITY_RANGE.max;
    if (wasSolid !== isSolid) {
      setWindowGlass(!isSolid).catch((e) => logService.warn(`set_window_glass failed: ${e}`));
    }
    lastOpacity = opacity;
    void emit(WINDOW_OPACITY_EVENT, { opacity });
  });
  return unsubscribe;
}
