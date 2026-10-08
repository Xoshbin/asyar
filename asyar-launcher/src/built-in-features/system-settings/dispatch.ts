import { hideWindow, openUrl } from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { findSettingsPane, settingsPaneUrl } from './panes';

/** Opens the System Settings pane behind a dynamic command, hiding the launcher first. */
export async function dispatchSettingsPaneCommand(dynamicId: string): Promise<void> {
  const pane = findSettingsPane(dynamicId);
  if (!pane) {
    logService.warn(`[system-settings] unknown settings pane: ${dynamicId}`);
    return;
  }
  await hideWindow();
  await openUrl(settingsPaneUrl(pane));
}
