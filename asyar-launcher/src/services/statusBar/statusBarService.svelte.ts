import { invoke } from '@tauri-apps/api/core';
import { envService } from '../envService';
import { logService } from '../log/logService';

export interface StatusBarItem {
  id: string;
  extensionId: string;
  icon?: string;
  text: string;
}

class StatusBarServiceClass {
  items = $state<StatusBarItem[]>([]);
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Initial sync could go here if needed, but registry is empty at start.
  }

  registerItem(item: StatusBarItem): void {
    const index = this.items.findIndex(i => i.extensionId === item.extensionId && i.id === item.id);
    if (index !== -1) {
      this.items[index] = item;
    } else {
      this.items.push(item);
    }
    this.#syncTrayMenu();
  }

  updateItem(
    extensionId: string,
    id: string,
    updates: Partial<Pick<StatusBarItem, 'icon' | 'text'>>
  ): void {
    const index = this.items.findIndex(i => i.extensionId === extensionId && i.id === id);
    if (index !== -1) {
      this.items[index] = { ...this.items[index], ...updates };
      this.#syncTrayMenu();
    }
  }

  unregisterItem(extensionId: string, id: string): void {
    this.items = this.items.filter(i => !(i.extensionId === extensionId && i.id === id));
    this.#syncTrayMenu();
  }

  clearItemsForExtension(extensionId: string): void {
    this.items = this.items.filter(i => i.extensionId !== extensionId);
    this.#syncTrayMenu();
  }

  #syncTrayMenu(): void {
    if (!envService.isTauri) return;

    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
    }

    this.#debounceTimer = setTimeout(() => {
      const trayItems = this.items.map(i => ({
        id: `${i.extensionId}:${i.id}`,
        label: [i.icon, i.text].filter(Boolean).join(' '),
      }));
      invoke('update_tray_menu', { items: trayItems }).catch((e) => logService.error(`[StatusBar] Failed to sync tray menu: ${e}`));
      this.#debounceTimer = null;
    }, 300);
  }
}

export const statusBarService = new StatusBarServiceClass();
