import { invokeSafeVoid } from './invokeSafe';

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

// Silent: callers throw on failure (see statusBarService.svelte.ts) so the
// extension-facing IPC router's own catch reports the diagnostic — avoids
// reporting the same failure twice.

export async function trayRegisterItem(item: StatusBarItem): Promise<boolean> {
  return invokeSafeVoid('tray_register_item', { item }, { silent: true });
}

export async function trayUpdateItem(item: StatusBarItem): Promise<boolean> {
  return invokeSafeVoid('tray_update_item', { item }, { silent: true });
}

export async function trayUnregisterItem(extensionId: string, id: string): Promise<boolean> {
  return invokeSafeVoid('tray_unregister_item', { extensionId, id }, { silent: true });
}

export async function trayRemoveAllForExtension(extensionId: string): Promise<boolean> {
  return invokeSafeVoid('tray_remove_all_for_extension', { extensionId }, { silent: true });
}
