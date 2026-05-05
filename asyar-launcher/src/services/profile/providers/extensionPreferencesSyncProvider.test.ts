import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionPreferencesSyncProvider } from './extensionPreferencesSyncProvider';
import type { SyncProviderData } from '../types';

const mockExport = vi.hoisted(() => ({
  rows: [
    { extensionId: 'ext1', commandId: null, key: 'foo', value: '"bar"', isEncrypted: false, updatedAt: 1000 },
    { extensionId: 'ext2', commandId: 'cmd1', key: 'baz', value: '"qux"', isEncrypted: false, updatedAt: 2000 },
  ],
}));

vi.mock('../../../lib/ipc/extensionPreferencesCommands', () => ({
  extensionPreferencesExportAll: vi.fn().mockResolvedValue(mockExport),
  extensionPreferencesImportAll: vi
    .fn()
    .mockResolvedValue({ itemsAdded: 0, itemsUpdated: 2, itemsSkipped: 0 }),
}));

// Tauri event listener — provider's subscribeToChanges hook listens for the
// Rust-emitted `asyar:preferences-changed` event. The mock captures the
// handler so the test can fire it directly.
const eventHandlers = new Map<string, (event: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventHandlers.set(eventName, handler);
    return () => eventHandlers.delete(eventName);
  }),
}));

describe('ExtensionPreferencesSyncProvider', () => {
  let provider: ExtensionPreferencesSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    provider = new ExtensionPreferencesSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('extension-preferences');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('replace');
    expect(provider.sensitiveFields).toEqual(['password']);
  });

  it('exportFull returns the IPC export payload', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('extension-preferences');
    expect(result.version).toBe(1);
    expect(result.data).toEqual(mockExport);
  });

  it('preview counts conflicts and new items by composite key', async () => {
    const incoming: SyncProviderData = {
      providerId: 'extension-preferences',
      version: 1,
      exportedAt: Date.now(),
      data: {
        rows: [
          { extensionId: 'ext1', commandId: null, key: 'foo', value: '"updated"', isEncrypted: false, updatedAt: 5000 },
          { extensionId: 'ext1', commandId: null, key: 'new', value: '"x"', isEncrypted: false, updatedAt: 5000 },
        ],
      },
    };
    const preview = await provider.preview(incoming);
    expect(preview.localCount).toBe(2);
    expect(preview.incomingCount).toBe(2);
    expect(preview.conflicts).toBe(1);
    expect(preview.newItems).toBe(1);
  });

  it('applyImport replace — calls IPC import with strategy', async () => {
    const { extensionPreferencesImportAll } = await import('../../../lib/ipc/extensionPreferencesCommands');
    const incoming: SyncProviderData = {
      providerId: 'extension-preferences',
      version: 1,
      exportedAt: Date.now(),
      data: { rows: [] },
    };
    await provider.applyImport(incoming, 'replace');
    expect(extensionPreferencesImportAll).toHaveBeenCalledWith({ rows: [] }, 'replace');
  });

  it('applyImport skip — does not call IPC', async () => {
    const { extensionPreferencesImportAll } = await import('../../../lib/ipc/extensionPreferencesCommands');
    const incoming: SyncProviderData = {
      providerId: 'extension-preferences',
      version: 1,
      exportedAt: Date.now(),
      data: { rows: [] },
    };
    const result = await provider.applyImport(incoming, 'skip');
    expect(extensionPreferencesImportAll).not.toHaveBeenCalled();
    expect(result.itemsAdded).toBe(0);
  });

  it('getLocalSummary returns the row count', async () => {
    const summary = await provider.getLocalSummary();
    expect(summary.itemCount).toBe(2);
    expect(summary.label).toBe('2 preferences');
  });

  describe('exportItems_returns_one_item_for_singleton', () => {
    it('returns a single SyncItem with id "extension-preferences"', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe('extension-preferences');
      expect(items[0].categoryId).toBe('extension-preferences');
      expect(items[0].content).toEqual(mockExport);
    });
  });

  describe('applyItemUpsert_writes_full_state', () => {
    it('hands the full preferences export to extensionPreferencesImportAll', async () => {
      const { extensionPreferencesImportAll } = await import('../../../lib/ipc/extensionPreferencesCommands');
      await provider.applyItemUpsert({
        id: 'extension-preferences',
        categoryId: 'extension-preferences',
        content: mockExport,
      });
      expect(extensionPreferencesImportAll).toHaveBeenCalledWith(mockExport, 'replace');
    });
  });

  describe('applyItemDelete_resets_to_default_or_throws_unsupported', () => {
    it('throws since extension-preferences is a singleton aggregate', async () => {
      await expect(provider.applyItemDelete('extension-preferences')).rejects.toThrow(/cannot delete singleton/i);
    });
  });

  describe('subscribeToChanges_emits_when_settings_change', () => {
    it('fires upsert when the asyar:preferences-changed event arrives', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      // Wait a tick for the async listen() registration to complete
      await Promise.resolve();
      const handler = eventHandlers.get('asyar:preferences-changed');
      expect(handler).toBeDefined();
      handler!({ payload: null });

      expect(events.length).toBe(1);
      expect(events[0]).toEqual({
        type: 'upsert',
        itemId: 'extension-preferences',
        categoryId: 'extension-preferences',
      });

      unsub();
    });
  });
});
