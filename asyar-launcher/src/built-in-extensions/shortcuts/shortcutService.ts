import { invoke } from '@tauri-apps/api/core';
import { shortcutStore, type ItemShortcut } from './shortcutStore';
import { applicationService } from '../../services/application/applicationsService';
import { commandService } from '../../services/extension/commandService';
import { parseShortcut } from './shortcutFormatter';
import { settingsService } from '../../services/settings/settingsService';
import { portalActivationId } from '../../services/ui/uiStateStore';

class ShortcutService {
  async init(): Promise<void> {
    const shortcuts = shortcutStore.getAll();
    await Promise.all(shortcuts.map(async s => {
      const [modifier, key] = parseShortcut(s.shortcut);
      try {
        await invoke('register_item_shortcut', { modifier, key, objectId: s.objectId });
      } catch (e) {
        console.warn(`Failed to re-register shortcut ${s.shortcut} for ${s.itemName}:`, e);
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
      console.error('Failed to register shortcut', e);
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
      console.error('Failed to unregister shortcut', e);
    }
  }

  getShortcutForItem(objectId: string): ItemShortcut | undefined {
    return shortcutStore.getByObjectId(objectId);
  }

  getAllShortcuts(): ItemShortcut[] {
    return shortcutStore.getAll();
  }

  async isConflict(shortcut: string, excludeObjectId?: string): Promise<{objectId: string, itemName: string} | null> {
    const existing = shortcutStore.getAll().find(s => s.shortcut === shortcut && s.objectId !== excludeObjectId);
    if (existing) {
      return { objectId: existing.objectId, itemName: existing.itemName };
    }

    try {
      const persisted = settingsService.getSettings().shortcut;
      const launcherShortcut = `${persisted.modifier}+${persisted.key}`;
      if (shortcut === launcherShortcut) {
        return { objectId: 'launcher', itemName: 'Launcher Toggle' };
      }
    } catch (e) {
      // ignore
    }

    return null;
  }

  async handleFiredShortcut(objectId: string): Promise<void> {
    const shortcutInfo = shortcutStore.getByObjectId(objectId);
    if (!shortcutInfo) {
      console.warn('Received shortcut for unknown objectId:', objectId);
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
        console.error('Failed to open app', e);
      }
    } else if (shortcutInfo.itemType === 'command') {
      // Portal commands need special handling: activate portal chip mode instead of
      // executing the URL directly (which would open the browser with an empty query).
      if (shortcutInfo.objectId.startsWith('cmd_portals_')) {
        const portalId = shortcutInfo.objectId.replace('cmd_portals_', '');
        await invoke('show');
        // Signal +page.svelte to activate portal mode for this portal ID
        portalActivationId.set(portalId);
      } else {
        try {
          await invoke('show');
          await commandService.executeCommand(shortcutInfo.objectId);
        } catch (e) {
          console.error('Failed to execute command', e);
        }
      }
    }
  }
}

export const shortcutService = new ShortcutService();
