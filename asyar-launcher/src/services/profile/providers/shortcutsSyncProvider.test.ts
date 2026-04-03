import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShortcutsSyncProvider } from './shortcutsSyncProvider';
import type { SyncProviderData } from '../types';

const mockShortcuts = [
  { id: '1', objectId: 'app-safari', itemName: 'Safari', itemType: 'application' as const, shortcut: 'ctrl+1', createdAt: 1000 },
  { id: '2', objectId: 'app-chrome', itemName: 'Chrome', itemType: 'application' as const, shortcut: 'ctrl+2', createdAt: 2000 },
];

vi.mock('../../../built-in-features/shortcuts/shortcutStore.svelte', () => ({
  shortcutStore: {
    getAll: vi.fn(() => [...mockShortcuts]),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('ShortcutsSyncProvider', () => {
  let provider: ShortcutsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ShortcutsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('shortcuts');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('merge');
    expect(provider.sensitiveFields).toEqual([]);
  });

  describe('exportFull', () => {
    it('exports all shortcuts', async () => {
      const result = await provider.exportFull();
      expect(result.providerId).toBe('shortcuts');
      expect(result.version).toBe(1);
      expect(result.data).toEqual(mockShortcuts);
      expect(result.binaryAssets).toBeUndefined();
    });
  });

  describe('exportForSync', () => {
    it('returns same data as exportFull', async () => {
      const full = await provider.exportFull();
      const sync = await provider.exportForSync();
      expect(sync.data).toEqual(full.data);
    });
  });

  describe('preview', () => {
    it('calculates correct preview stats', async () => {
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: '3', objectId: 'app-safari', itemName: 'Safari', itemType: 'application', shortcut: 'ctrl+1', createdAt: 3000 }, // conflict
          { id: '4', objectId: 'app-firefox', itemName: 'Firefox', itemType: 'application', shortcut: 'ctrl+3', createdAt: 3000 }, // new
        ],
      };

      const preview = await provider.preview(incoming);
      expect(preview.localCount).toBe(2);
      expect(preview.incomingCount).toBe(2);
      expect(preview.conflicts).toBe(1); // app-safari exists in both
      expect(preview.newItems).toBe(1);  // app-firefox is new
      expect(preview.removedItems).toBe(1); // app-chrome only in local
    });
  });

  describe('applyImport', () => {
    it('replace — removes all existing and adds incoming', async () => {
      const { shortcutStore } = await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: '10', objectId: 'app-vscode', itemName: 'VSCode', itemType: 'application', shortcut: 'ctrl+0', createdAt: 5000 },
        ],
      };

      const result = await provider.applyImport(incoming, 'replace');
      expect(shortcutStore.remove).toHaveBeenCalledTimes(2); // removes existing 2
      expect(shortcutStore.add).toHaveBeenCalledTimes(1);    // adds 1 incoming
      expect(result.success).toBe(true);
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsRemoved).toBe(2);
    });

    it('merge — adds new, updates newer, skips older', async () => {
      const { shortcutStore } = await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [
          { id: '1', objectId: 'app-safari', itemName: 'Safari', itemType: 'application', shortcut: 'ctrl+1', createdAt: 9999 }, // newer → update
          { id: '2', objectId: 'app-chrome', itemName: 'Chrome', itemType: 'application', shortcut: 'ctrl+2', createdAt: 500 },  // older → skip
          { id: '5', objectId: 'app-firefox', itemName: 'Firefox', itemType: 'application', shortcut: 'ctrl+3', createdAt: 5000 }, // new → add
        ],
      };

      const result = await provider.applyImport(incoming, 'merge');
      expect(shortcutStore.add).toHaveBeenCalledTimes(1);    // app-firefox
      expect(shortcutStore.update).toHaveBeenCalledTimes(1); // app-safari (newer)
      expect(result.itemsAdded).toBe(1);
      expect(result.itemsUpdated).toBe(1);
    });

    it('skip — does nothing', async () => {
      const { shortcutStore } = await import('../../../built-in-features/shortcuts/shortcutStore.svelte');
      const incoming: SyncProviderData = {
        providerId: 'shortcuts',
        version: 1,
        exportedAt: Date.now(),
        data: [{ id: '99', objectId: 'app-x', itemName: 'X', itemType: 'application', shortcut: 'ctrl+x', createdAt: 1 }],
      };

      const result = await provider.applyImport(incoming, 'skip');
      expect(shortcutStore.add).not.toHaveBeenCalled();
      expect(shortcutStore.update).not.toHaveBeenCalled();
      expect(shortcutStore.remove).not.toHaveBeenCalled();
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('getLocalSummary', () => {
    it('returns correct count and label', async () => {
      const summary = await provider.getLocalSummary();
      expect(summary.itemCount).toBe(2);
      expect(summary.label).toBe('2 shortcuts');
    });
  });
});
