import type { ShortcutInfo } from 'asyar-sdk/contracts';
import { shortcutsList, shortcutsRun } from '../../lib/ipc/systemCommands';

/**
 * Host-side thin wrapper over the Rust `shortcuts_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) as the first arg; privileged host calls pass `null`.
 */
export const shortcutsService = {
  async list(extensionId: string | null): Promise<ShortcutInfo[]> {
    return shortcutsList(extensionId);
  },
  async run(extensionId: string | null, idOrName: string, input?: string | null): Promise<string> {
    return shortcutsRun(extensionId, idOrName, input ?? null);
  },
};
