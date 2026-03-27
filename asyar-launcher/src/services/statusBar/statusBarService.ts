import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { envService } from '../envService';
import { logService } from '../log/logService';

export interface StatusBarItem {
  id: string;
  extensionId: string;
  icon?: string;
  text: string;
}

export const statusBarItemsStore = writable<StatusBarItem[]>([]);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Syncs the current store state to the Rust tray menu. */
function syncTrayMenu(items: StatusBarItem[]): void {
  if (!envService.isTauri) return;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    const trayItems = items.map(i => ({
      id: `${i.extensionId}:${i.id}`,
      label: [i.icon, i.text].filter(Boolean).join(' '),
    }));
    invoke('update_tray_menu', { items: trayItems }).catch((e) => logService.error(`[StatusBar] Failed to sync tray menu: ${e}`));
    debounceTimer = null;
  }, 300);
}

// Whenever the store changes, push the new items to the native tray menu
statusBarItemsStore.subscribe(syncTrayMenu);

export const statusBarService = {
  registerItem(item: StatusBarItem): void {
    statusBarItemsStore.update(items => {
      // Replace if same extensionId + id already exists
      const filtered = items.filter(
        i => !(i.extensionId === item.extensionId && i.id === item.id)
      );
      return [...filtered, item];
    });
  },

  updateItem(
    extensionId: string,
    id: string,
    updates: Partial<Pick<StatusBarItem, 'icon' | 'text'>>
  ): void {
    statusBarItemsStore.update(items =>
      items.map(i => i.extensionId === extensionId && i.id === id ? { ...i, ...updates } : i)
    );
  },

  unregisterItem(extensionId: string, id: string): void {
    statusBarItemsStore.update(items => items.filter(i => !(i.extensionId === extensionId && i.id === id)));
  },

  clearItemsForExtension(extensionId: string): void {
    statusBarItemsStore.update(items =>
      items.filter(i => i.extensionId !== extensionId)
    );
  },
};
