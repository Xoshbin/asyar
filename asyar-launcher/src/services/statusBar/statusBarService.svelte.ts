import { invoke } from '@tauri-apps/api/core';
import { envService } from '../envService';
import { logService } from '../log/logService';

/**
 * Launcher-side image of the SDK's `IStatusBarItem` plus the
 * `extensionId` the proxy injects before IPC. Mirrors the Rust
 * `StatusBarItem` so we can forward verbatim to the tray manager.
 */
export interface StatusBarItem {
  id: string;
  extensionId: string;
  icon?: string;
  iconPath?: string;
  text: string;
  checked?: boolean;
  submenu?: StatusBarItem[];
  enabled?: boolean;
  separator?: boolean;
}

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
    if (!envService.isTauri) return;
    logService.debug(
      `[StatusBar] registerItem ext='${item.extensionId}' id='${item.id}'`,
    );
    await invoke('tray_register_item', { item });
  }

  async updateItem(
    extensionId: string,
    id: string,
    updates: Partial<StatusBarItem> & { item?: StatusBarItem },
  ): Promise<void> {
    if (!envService.isTauri) return;
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
    await invoke('tray_update_item', { item });
  }

  async unregisterItem(extensionId: string, id: string): Promise<void> {
    if (!envService.isTauri) return;
    await invoke('tray_unregister_item', { extensionId, id });
  }

  async clearItemsForExtension(extensionId: string): Promise<void> {
    if (!envService.isTauri) return;
    await invoke('tray_remove_all_for_extension', { extensionId });
  }
}

export const statusBarService = new StatusBarServiceClass();
