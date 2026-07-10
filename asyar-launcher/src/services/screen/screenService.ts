import type { PickedColor } from 'asyar-sdk/contracts';
import { screenPickColor } from '../../lib/ipc/systemCommands';

/**
 * Host-side thin wrapper over the Rust `screen_pick_color` Tauri command.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) so `pickColor` takes the caller id as its first
 * arg. Privileged host-context calls pass `null`. A `null` result means the
 * user cancelled the eyedropper.
 */
export const screenService = {
  async pickColor(extensionId: string | null): Promise<PickedColor | null> {
    return screenPickColor(extensionId);
  },
};
