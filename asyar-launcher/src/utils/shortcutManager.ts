import { updateGlobalShortcut } from '../lib/ipc/commands';
import { logService } from '../services/log/logService';
import { settingsService } from '../services/settings/settingsService.svelte';

/**
 * Update the global shortcut
 */
export async function updateShortcut(modifier: string, key: string): Promise<boolean> {
  logService.info(`Updating shortcut to: ${modifier ? `${modifier}+${key}` : key}`);

  // Update the system shortcut via Rust
  try {
    await updateGlobalShortcut(modifier, key);
  } catch (error) {
    logService.error(`Failed to update shortcut: ${error}`);
    return false;
  }

  // Save to settings store
  try {
    const success = await settingsService.updateSettings('shortcut', {
      modifier,
      key,
    });

    if (success) {
      logService.info('Shortcut updated successfully');
      return true;
    } else {
      logService.error('Failed to update shortcut: Failed to save shortcut settings');
      return false;
    }
  } catch (error) {
    logService.error(`Failed to update shortcut: ${error}`);
    return false;
  }
}
