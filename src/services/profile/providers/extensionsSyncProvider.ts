import { extensionStateManager } from '../../extension/extensionStateManager.svelte';
import { settingsService } from '../../settings/settingsService.svelte';
import type {
  ISyncProvider,
  SyncProviderData,
  ImportPreview,
  ImportResult,
  DataSummary,
  ConflictStrategy,
  SyncItem,
  SyncChangeEvent,
  Unsubscribe,
} from '../types';

interface ExtensionInfo {
  id: string;
  title: string;
  version: string;
  isBuiltIn: boolean;
  enabled: boolean;
}

interface ExtensionsData {
  installed: ExtensionInfo[];
  enabledStates: Record<string, boolean>;
}

export class ExtensionsSyncProvider implements ISyncProvider {
  readonly id = 'extensions';
  readonly displayName = 'Extensions';
  readonly icon = 'puzzle';
  readonly syncTier = 'core' as const;
  readonly defaultEnabled = true;
  readonly defaultConflictStrategy = 'replace' as const;
  readonly sensitiveFields: string[] = [];

  async exportFull(): Promise<SyncProviderData> {
    const all = await extensionStateManager.getAllExtensionsWithState();
    const userInstalled = all.filter(ext => !ext.isBuiltIn);
    const installed: ExtensionInfo[] = userInstalled.map(ext => ({
      id: ext.id,
      title: ext.title,
      version: ext.version,
      isBuiltIn: false,
      enabled: ext.enabled,
    }));
    const enabledStates: Record<string, boolean> = {};
    for (const ext of userInstalled) {
      enabledStates[ext.id] = ext.enabled;
    }
    return {
      providerId: this.id,
      version: 1,
      exportedAt: Date.now(),
      data: { installed, enabledStates },
    };
  }

  async exportForSync(): Promise<SyncProviderData> {
    return this.exportFull();
  }

  async preview(incoming: SyncProviderData): Promise<ImportPreview> {
    const all = await extensionStateManager.getAllExtensionsWithState();
    const incomingData = incoming.data as ExtensionsData;

    return {
      localCount: all.filter(e => !e.isBuiltIn).length,
      incomingCount: incomingData.installed.filter(e => !e.isBuiltIn).length,
      conflicts: 0,
      newItems: 0,
      removedItems: 0,
    };
  }

  async applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult> {
    if (strategy === 'skip') {
      return { success: true, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, warnings: [] };
    }

    const incomingData = incoming.data as ExtensionsData;

    // Restore enabled states
    await settingsService.updateSettings('extensions', { enabled: incomingData.enabledStates });

    // Warn about non-built-in extensions that need reinstallation
    const currentAll = await extensionStateManager.getAllExtensionsWithState();
    const currentIds = new Set(currentAll.map(e => e.id));
    const warnings: string[] = [];

    for (const ext of incomingData.installed) {
      if (!ext.isBuiltIn && !currentIds.has(ext.id)) {
        warnings.push(`Extension "${ext.title}" (${ext.id}) needs to be reinstalled manually`);
      }
    }

    return {
      success: true,
      itemsAdded: 0,
      itemsUpdated: Object.keys(incomingData.enabledStates).length,
      itemsRemoved: 0,
      warnings,
    };
  }

  async getLocalSummary(): Promise<DataSummary> {
    const all = await extensionStateManager.getAllExtensionsWithState();
    const count = all.filter(e => !e.isBuiltIn).length;
    return { itemCount: count, label: `${count} extension(s)` };
  }

  // ── Delta sync surface ──────────────────────────────────────────────────
  // Collection: one SyncItem per user-installed extension keyed by extension
  // id. Sync only carries enabled-state metadata — the extension package
  // itself is reinstalled out-of-band on each device.

  async exportItems(): Promise<SyncItem[]> {
    const all = await extensionStateManager.getAllExtensionsWithState();
    return all
      .filter((ext) => !ext.isBuiltIn)
      .map((ext) => ({
        id: ext.id,
        categoryId: this.id,
        content: {
          id: ext.id,
          title: ext.title,
          version: ext.version,
          isBuiltIn: false,
          enabled: ext.enabled,
        },
      }));
  }

  async applyItemUpsert(item: SyncItem): Promise<void> {
    const incoming = item.content as { id: string; enabled: boolean };
    const current = settingsService.currentSettings.extensions?.enabled ?? {};
    await settingsService.updateSettings('extensions', {
      enabled: { ...current, [incoming.id]: incoming.enabled },
    });
  }

  async applyItemDelete(itemId: string): Promise<void> {
    const current = settingsService.currentSettings.extensions?.enabled ?? {};
    const next: Record<string, boolean> = { ...current };
    delete next[itemId];
    await settingsService.updateSettings('extensions', { enabled: next });
  }

  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe {
    // Settings is the source of truth for enabled-state. We can't tell from
    // a settings emit which extension changed without diffing, so emit a
    // wildcard upsert and let the cloud sync service (Task 4B) re-export
    // and diff against the journal hashes. itemId='*' is a sentinel meaning
    // "any item under this category may have changed".
    let primed = false;
    return settingsService.subscribe(() => {
      if (!primed) {
        primed = true;
        return;
      }
      callback({ type: 'upsert', itemId: '*', categoryId: this.id });
    });
  }
}
