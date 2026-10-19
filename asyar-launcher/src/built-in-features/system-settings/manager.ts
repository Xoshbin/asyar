import { platform } from '@tauri-apps/plugin-os';
import { replaceDynamicCommandsBuiltin } from '../../lib/ipc/commands';
import { t } from '../../services/i18n';
import { logService } from '../../services/log/logService';
import { settingsPaneName, settingsPanesFor } from './panes';

export const SYSTEM_SETTINGS_EXTENSION_ID = 'system-settings';

/**
 * Registers one dynamic command per settings pane of the current platform
 * (none where `settingsPanesFor` has no table yet).
 */
export async function registerSettingsPaneCommands(): Promise<void> {
  const regs = settingsPanesFor(platform()).map((pane) => ({
    id: pane.id,
    name: settingsPaneName(pane),
    description: t('features.system_settings.pane_desc'),
    icon: pane.icon,
  }));
  try {
    await replaceDynamicCommandsBuiltin(SYSTEM_SETTINGS_EXTENSION_ID, regs);
  } catch (err) {
    logService.error(`[system-settings] failed to register pane commands: ${err}`);
  }
}

export async function unregisterSettingsPaneCommands(): Promise<void> {
  try {
    await replaceDynamicCommandsBuiltin(SYSTEM_SETTINGS_EXTENSION_ID, []);
  } catch (err) {
    logService.error(`[system-settings] failed to unregister pane commands: ${err}`);
  }
}
