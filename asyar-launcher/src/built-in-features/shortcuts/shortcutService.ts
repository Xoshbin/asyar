import { invoke } from '@tauri-apps/api/core';
import { shortcutStore, type ItemShortcut } from './shortcutStore.svelte';
import { applicationService } from '../../services/application/applicationsService';
import { commandService } from '../../services/extension/commandService.svelte';
import { parseShortcut, normalizeShortcut, VALID_KEYS, initValidKeys } from './shortcutFormatter';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { contextActivationId } from '../../services/context/contextModeService.svelte';
import { logService } from '../../services/log/logService';

class ShortcutService {
  async init(): Promise<void> {
    await initValidKeys();

    const shortcuts = shortcutStore.shortcuts;
    await Promise.all(shortcuts.map(async s => {
      const [modifier, key] = parseShortcut(s.shortcut);
      try {
        await invoke('register_item_shortcut', { modifier, key, objectId: s.objectId });
      } catch (e) {
        logService.warn(`Failed to re-register shortcut ${s.shortcut} for ${s.itemName}: ${e}`);
      }
    }));
  }

  async register(
    objectId: string, 
    itemName: string, 
    itemType: 'application' | 'command', 
    shortcut: string, 
    itemPath?: string
  ): Promise<{ok: boolean; conflict?: {objectId: string, itemName: string}}> {
    const conflict = await this.isConflict(shortcut, objectId);
    if (conflict) {
      return { ok: false, conflict };
    }

    const [modifier, key] = parseShortcut(shortcut);
    
    // Unregister existing shortcut for this item if any
    const existing = shortcutStore.getByObjectId(objectId);
    if (existing) {
      await this.unregister(objectId);
    }

    try {
      await invoke('register_item_shortcut', { modifier, key, objectId });
      shortcutStore.add({
        id: crypto.randomUUID(),
        objectId,
        itemName,
        itemType,
        itemPath,
        shortcut,
        createdAt: Date.now()
      });
      return { ok: true };
    } catch (e) {
      logService.error(`Failed to register shortcut: ${e}`);
      return { ok: false, conflict: { objectId: 'error', itemName: String(e) } };
    }
  }

  async unregister(objectId: string): Promise<void> {
    const existing = shortcutStore.getByObjectId(objectId);
    if (!existing) return;

    const [modifier, key] = parseShortcut(existing.shortcut);
    try {
      await invoke('unregister_item_shortcut', { modifier, key });
      shortcutStore.remove(objectId);
    } catch (e) {
      logService.error(`Failed to unregister shortcut: ${e}`);
    }
  }

  getShortcutForItem(objectId: string): ItemShortcut | undefined {
    return shortcutStore.getByObjectId(objectId);
  }

  getAllShortcuts(): ItemShortcut[] {
    return shortcutStore.getAll();
  }

  async isConflict(shortcut: string, excludeObjectId?: string): Promise<{objectId: string, itemName: string} | null> {
    const normalized = normalizeShortcut(shortcut);
    const all = shortcutStore.getAll();
    const existing = all.find(s => normalizeShortcut(s.shortcut) === normalized && s.objectId !== excludeObjectId);
    if (existing) {
      return { objectId: existing.objectId, itemName: existing.itemName };
    }

    try {
      if (excludeObjectId !== 'launcher') {
        const persisted = settingsService.getSettings().shortcut;
        const launcherShortcut = normalizeShortcut(`${persisted.modifier}+${persisted.key}`);
        if (normalized === launcherShortcut) {
          return { objectId: 'launcher', itemName: 'Launcher Toggle' };
        }
      }
    } catch (e) {
      // ignore
    }

    return null;
  }

  async handleFiredShortcut(objectId: string): Promise<void> {
    const shortcutInfo = shortcutStore.getByObjectId(objectId);
    if (!shortcutInfo) {
      logService.warn(`Received shortcut for unknown objectId: ${objectId}`);
      return;
    }

    if (shortcutInfo.itemType === 'application') {
      try {
        await applicationService.open({
          objectId: shortcutInfo.objectId,
          name: shortcutInfo.itemName,
          path: shortcutInfo.itemPath || '',
          type: 'application',
          score: 1,
          icon: '' // Not used by opening logic
        });
      } catch (e) {
        logService.error(`Failed to open app: ${e}`);
      }
    } else if (shortcutInfo.itemType === 'command') {
      // Portal commands need special handling: activate portal chip mode instead of
      // executing the URL directly (which would open the browser with an empty query).
      if (shortcutInfo.objectId.startsWith('cmd_portals_')) {
        const portalId = shortcutInfo.objectId.replace('cmd_portals_', '');
        await invoke('show');
        // Signal +page.svelte to activate portal mode for this portal ID
        contextActivationId.set(portalId);
      } else {
        try {
          await invoke('show');
          await commandService.executeCommand(shortcutInfo.objectId);
        } catch (e) {
          logService.error(`Failed to execute command: ${e}`);
        }
      }
    }
  }
}

export const shortcutService = new ShortcutService();
