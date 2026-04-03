import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileService } from './profileService';
import type { ISyncProvider, SyncProviderData, ImportPreview, ImportResult, DataSummary } from './types';

function createMockProvider(overrides: Partial<ISyncProvider> = {}): ISyncProvider {
  return {
    id: 'test-provider',
    displayName: 'Test Provider',
    icon: 'test-icon',
    syncTier: 'core',
    defaultEnabled: true,
    defaultConflictStrategy: 'merge',
    sensitiveFields: [],
    exportFull: vi.fn().mockResolvedValue({
      providerId: 'test-provider',
      version: 1,
      exportedAt: Date.now(),
      data: [{ id: '1', name: 'item1' }],
    } satisfies SyncProviderData),
    exportForSync: vi.fn().mockResolvedValue({
      providerId: 'test-provider',
      version: 1,
      exportedAt: Date.now(),
      data: [{ id: '1', name: 'item1' }],
    }),
    preview: vi.fn().mockResolvedValue({
      localCount: 3,
      incomingCount: 2,
      conflicts: 1,
      newItems: 1,
      removedItems: 1,
    } satisfies ImportPreview),
    applyImport: vi.fn().mockResolvedValue({
      success: true,
      itemsAdded: 1,
      itemsUpdated: 1,
      itemsRemoved: 0,
      warnings: [],
    } satisfies ImportResult),
    getLocalSummary: vi.fn().mockResolvedValue({
      itemCount: 3,
      label: '3 items',
    } satisfies DataSummary),
    ...overrides,
  };
}

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(() => {
    service = new ProfileService();
  });

  describe('registerProvider', () => {
    it('registers a provider and makes it retrievable', () => {
      const provider = createMockProvider();
      service.registerProvider(provider);
      expect(service.getProviders()).toHaveLength(1);
      expect(service.getProviders()[0].id).toBe('test-provider');
    });

    it('rejects duplicate provider IDs', () => {
      const provider1 = createMockProvider({ id: 'dupe' });
      const provider2 = createMockProvider({ id: 'dupe' });
      service.registerProvider(provider1);
      expect(() => service.registerProvider(provider2)).toThrow('already registered');
    });
  });

  describe('getProviders', () => {
    it('returns all registered providers', () => {
      service.registerProvider(createMockProvider({ id: 'a' }));
      service.registerProvider(createMockProvider({ id: 'b' }));
      service.registerProvider(createMockProvider({ id: 'c' }));
      expect(service.getProviders()).toHaveLength(3);
    });

    it('returns empty array when none registered', () => {
      expect(service.getProviders()).toEqual([]);
    });
  });

  describe('getProviderById', () => {
    it('returns provider by ID', () => {
      service.registerProvider(createMockProvider({ id: 'snippets' }));
      expect(service.getProviderById('snippets')?.id).toBe('snippets');
    });

    it('returns undefined for unknown ID', () => {
      expect(service.getProviderById('nonexistent')).toBeUndefined();
    });
  });

  describe('collectExportData', () => {
    it('calls exportFull on selected providers in full mode', async () => {
      const provider = createMockProvider({ id: 'snippets' });
      service.registerProvider(provider);

      const result = await service.collectExportData({ mode: 'full', categoryIds: ['snippets'] });

      expect(provider.exportFull).toHaveBeenCalled();
      expect(result.size).toBe(1);
      expect(result.has('snippets')).toBe(true);
    });

    it('calls exportForSync on selected providers in sync mode', async () => {
      const provider = createMockProvider({ id: 'snippets' });
      service.registerProvider(provider);

      const result = await service.collectExportData({ mode: 'sync', categoryIds: ['snippets'] });

      expect(provider.exportForSync).toHaveBeenCalled();
      expect(result.size).toBe(1);
    });

    it('exports all defaultEnabled providers when no categoryIds specified', async () => {
      service.registerProvider(createMockProvider({ id: 'a', defaultEnabled: true }));
      service.registerProvider(createMockProvider({ id: 'b', defaultEnabled: false }));
      service.registerProvider(createMockProvider({ id: 'c', defaultEnabled: true }));

      const result = await service.collectExportData({ mode: 'full' });
      expect(result.size).toBe(2);
      expect(result.has('a')).toBe(true);
      expect(result.has('c')).toBe(true);
      expect(result.has('b')).toBe(false);
    });
  });

  describe('buildManifest', () => {
    it('builds a manifest from collected data', () => {
      const provider = createMockProvider({ id: 'snippets', sensitiveFields: [] });
      service.registerProvider(provider);

      const exportData = new Map<string, SyncProviderData>();
      exportData.set('snippets', {
        providerId: 'snippets',
        version: 1,
        exportedAt: 1234567890,
        data: [{ id: '1' }, { id: '2' }],
      });

      const manifest = service.buildManifest(exportData, null);
      expect(manifest.formatVersion).toBe(1);
      expect(manifest.categories).toHaveLength(1);
      expect(manifest.categories[0].id).toBe('snippets');
      expect(manifest.categories[0].itemCount).toBe(2);
      expect(manifest.hasSensitiveData).toBe(false);
    });

    it('sets hasSensitiveData when a provider has sensitive fields', () => {
      const provider = createMockProvider({ id: 'ai', sensitiveFields: ['apiKey'] });
      service.registerProvider(provider);

      const exportData = new Map<string, SyncProviderData>();
      exportData.set('ai', {
        providerId: 'ai',
        version: 1,
        exportedAt: 1234567890,
        data: { apiKey: 'secret' },
      });

      const manifest = service.buildManifest(exportData, 'my-password');
      expect(manifest.hasSensitiveData).toBe(true);
      expect(manifest.categories[0].hasSensitiveFields).toBe(true);
      expect(manifest.categories[0].sensitiveFieldsHandling).toBe('encrypted');
    });
  });
});
