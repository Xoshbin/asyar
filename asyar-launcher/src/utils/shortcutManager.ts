import { invoke } from "@tauri-apps/api/core";
import { logService } from "../services/logService";
import { settingsService } from "../services/settingsService";

// Available modifiers and keys
const availableModifiers = ["Alt", "Ctrl", "Shift", "Super"];
const availableKeys = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "Space",
  "Tab",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Right",
  "Left",
  "Down",
  "Up",
  ";",
  "=",
  ",",
  "-",
  ".",
  "/",
  "\\",
  "'",
  "[",
  "]",
];

/**
 * Get the currently configured shortcut
 */
export async function getShortcutConfig() {
  const settings = settingsService.getSettings();
  return {
    modifier: settings.shortcut.modifier,
    key: settings.shortcut.key,
  };
}

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

/**
 * Get available modifiers
 */
export function getAvailableModifiers(): string[] {
  return availableModifiers;
}

/**
 * Get available keys
 */
export function getAvailableKeys(): string[] {
  return availableKeys;
}
