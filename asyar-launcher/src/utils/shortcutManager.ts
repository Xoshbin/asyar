import { invoke } from "@tauri-apps/api/core";
import { logService } from "../services/log/logService";
import { settingsService } from "../services/settings/settingsService.svelte";

/**
 * Update the global shortcut
 */
export async function updateShortcut(
  modifier: string,
  key: string
): Promise<boolean> {
  try {
    logService.info(`Updating shortcut to: ${modifier}+${key}`);

    // Update the system shortcut via Rust
    await invoke("update_global_shortcut", { modifier, key });

    // Save to settings store
    const success = await settingsService.updateSettings("shortcut", {
      modifier,
      key,
    });

    if (success) {
      logService.info("Shortcut updated successfully");
      return true;
    } else {
      throw new Error("Failed to save shortcut settings");
    }
  } catch (error) {
    logService.error(`Failed to update shortcut: ${error}`);
    return false;
  }
}
