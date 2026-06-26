import { logService } from '../log/logService';
import {
  trayRegisterItem,
  trayUpdateItem,
  trayUnregisterItem,
  trayRemoveAllForExtension,
  type StatusBarItem,
} from '../../lib/ipc/statusBarCommands';

export type { StatusBarItem };

/**
 * Thin dispatcher between the extension's IPC call and the Rust tray
 * manager. Each top-level registration lands as an independent
 * `TrayIcon` owned by the host — there is no shared "merged" tray, and
 * no debounce.
 */
class StatusBarServiceClass {
  // NOTE: methods return `Promise<void>` (not `void`) so IPC errors
  // propagate back to the extension's proxy via the IPC router's
  // try/catch. Without this, a Rust-side failure (e.g., validation or a
  // malformed tree) would be logged on the host and silently succeed from
  // the extension's perspective.
  async registerItem(item: StatusBarItem): Promise<void> {
    logService.debug(
      `[StatusBar] registerItem ext='${item.extensionId}' id='${item.id}'`,
    );
    const ok = await trayRegisterItem(item);
    if (!ok) throw new Error('tray_register_item failed');
  }

  async updateItem(
    extensionId: string,
    id: string,
    updates: Partial<StatusBarItem> & { item?: StatusBarItem },
  ): Promise<void> {
    // The proxy always sends the full merged tree under `item` — we use
    // that. Falling back to (extensionId, id, updates) shape lets the
    // service stay forgiving for host-side callers.
    const item: StatusBarItem = updates.item ?? {
      id,
      extensionId,
      text: '',
      ...updates,
    };
    logService.debug(`[StatusBar] updateItem ext='${extensionId}' id='${id}'`);
    const ok = await trayUpdateItem(item);
    if (!ok) throw new Error('tray_update_item failed');
  }

  async unregisterItem(extensionId: string, id: string): Promise<void> {
    const ok = await trayUnregisterItem(extensionId, id);
    if (!ok) throw new Error('tray_unregister_item failed');
  }

  async clearItemsForExtension(extensionId: string): Promise<void> {
    const ok = await trayRemoveAllForExtension(extensionId);
    if (!ok) throw new Error('tray_remove_all_for_extension failed');
  }
}

export const statusBarService = new StatusBarServiceClass();
