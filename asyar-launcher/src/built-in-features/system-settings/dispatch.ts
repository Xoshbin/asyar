import { platform } from '@tauri-apps/plugin-os';
import { hideWindow, openSettingsPane, showWindow } from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import type { BuiltinDispatchResult } from '../../services/extension/builtinDynamicDispatchers';
import { findSettingsPane } from './panes';

/**
 * Opens the settings pane behind a dynamic command, hiding the launcher
 * first. If the pane does not open, the launcher comes back so the user is
 * not left without feedback, and `keep-open` tells the manager not to re-hide it.
 */
export async function dispatchSettingsPaneCommand(
  dynamicId: string,
): Promise<void | BuiltinDispatchResult> {
  const pane = findSettingsPane(platform(), dynamicId);
  if (!pane) {
    logService.warn(`[system-settings] unknown settings pane: ${dynamicId}`);
    return;
  }
  await hideWindow();
  let opened = false;
  try {
    opened = await openSettingsPane(pane.bundleId);
  } finally {
    if (!opened) await showWindow();
  }
  if (!opened) return { type: 'keep-open' };
}
