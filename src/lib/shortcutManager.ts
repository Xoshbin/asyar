import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Interface representing shortcut configuration
 */
interface ShortcutConfig {
  modifier: string;
  key: string;
}

/**
 * Gets the current shortcut configuration
 * @returns {Promise<ShortcutConfig>} The current shortcut configuration
 */
export async function getShortcutConfig(): Promise<ShortcutConfig> {
  try {
    return await invoke<ShortcutConfig>("get_shortcut_config");
  } catch (error) {
    console.error("Failed to get shortcut config:", error);
    // Return default if there's an error
    return { modifier: "Super", key: "K" };
  }
}

/**
 * Updates the global shortcut configuration
 * @param {string} modifier - The modifier key (Super, Shift, Control, Alt)
 * @param {string} key - The key to use with the modifier
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function updateShortcut(
  modifier: string,
  key: string
): Promise<boolean> {
  try {
    await invoke("update_global_shortcut", { modifier, key });
    return true;
  } catch (error) {
    console.error("Failed to update shortcut:", error);
    return false;
  }
}

/**
 * Type representing available modifier keys
 */
type ModifierKey = "Super" | "Shift" | "Control" | "Alt";

/**
 * Gets all available modifiers
 * @returns {Array<ModifierKey>} List of available modifiers
 */
export function getAvailableModifiers(): ModifierKey[] {
  return ["Super", "Shift", "Control", "Alt"];
}

/**
 * Gets all available keys
 * @returns {Array<string>} List of available keys
 */
export function getAvailableKeys(): string[] {
  return [
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
  ];
}
