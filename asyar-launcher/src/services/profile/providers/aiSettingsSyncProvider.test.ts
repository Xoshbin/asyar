import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AISettingsSyncProvider } from './aiSettingsSyncProvider';
import type { SyncProviderData } from '../types';

const mockSettings = vi.hoisted(() => ({
  providers: {
    openai: { enabled: true, apiKey: 'sk-secret' },
    anthropic: { enabled: false },
    google: { enabled: false },
    ollama: { enabled: false },
    openrouter: { enabled: false },
    custom: { enabled: false },
  },
  activeProviderId: 'openai' as const,
  activeModelId: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 2048,
  allowExtensionUse: true,
}));

vi.mock('../../../built-in-features/ai-chat/aiStore.svelte', () => ({
  aiStore: {
    settings: { ...mockSettings },
    updateAISettings: vi.fn(),
  },
}));

// Mock settingsService.subscribe so the provider's change subscription
// can be driven from the test without spinning up Svelte's $effect runtime.
vi.mock('../../../services/settings/settingsService.svelte', () => {
  const subscribers = new Set<() => void>();
  return {
    settingsService: {
      subscribe: vi.fn((cb: () => void) => {
        subscribers.add(cb);
        cb(); // prime, same as production effect.root semantics
        return () => subscribers.delete(cb);
      }),
      __emit: () => subscribers.forEach((cb) => cb()),
    },
  };
});

describe('AISettingsSyncProvider', () => {
  let provider: AISettingsSyncProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AISettingsSyncProvider();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('ai-settings');
    expect(provider.syncTier).toBe('core');
    expect(provider.defaultEnabled).toBe(true);
    expect(provider.defaultConflictStrategy).toBe('replace');
    expect(provider.sensitiveFields).toEqual(['providers']);
  });

  it('exportFull returns current AI settings', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('ai-settings');
    expect(result.version).toBe(2);
    expect(result.data).toMatchObject({ activeProviderId: 'openai' });
    expect(result.binaryAssets).toBeUndefined();
  });

  it('preview returns 1/1', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: { ...mockSettings, activeProviderId: 'anthropic' as const },
    };

    const preview = await provider.preview(incoming);
    expect(preview.localCount).toBe(1);
    expect(preview.incomingCount).toBe(1);
    expect(preview.conflicts).toBe(1);
    expect(preview.newItems).toBe(0);
    expect(preview.removedItems).toBe(0);
  });

  it('applyImport replace — updates settings', async () => {
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    const newSettings = { ...mockSettings, activeProviderId: 'anthropic' as const };
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: newSettings,
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(result.success).toBe(true);
    expect(result.itemsUpdated).toBe(1);
    expect(aiStore.updateAISettings).toHaveBeenCalledWith(newSettings);
  });

  it('applyImport skip — does nothing', async () => {
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: { ...mockSettings, activeProviderId: 'anthropic' as const },
    };

    const result = await provider.applyImport(incoming, 'skip');
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
    expect(aiStore.updateAISettings).not.toHaveBeenCalled();
  });

  it('getLocalSummary returns label with enabled count', async () => {
    const summary = await provider.getLocalSummary();
    expect(summary.itemCount).toBe(1);
    expect(summary.label).toContain('enabled');
  });

  describe('exportItems_returns_one_item_with_id_ai_settings_for_singleton', () => {
    it('returns a single SyncItem with id "ai-settings"', async () => {
      const items = await provider.exportItems();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe('ai-settings');
      expect(items[0].categoryId).toBe('ai-settings');
      expect(items[0].content).toMatchObject({ activeProviderId: 'openai' });
    });
  });

  describe('applyItemUpsert_writes_full_state', () => {
    it('hands the full settings object to aiStore.updateAISettings', async () => {
      const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
      const newSettings = { ...mockSettings, activeProviderId: 'anthropic' as const };
      await provider.applyItemUpsert({ id: 'ai-settings', categoryId: 'ai-settings', content: newSettings });
      expect(aiStore.updateAISettings).toHaveBeenCalledWith(newSettings);
    });
  });

  describe('applyItemDelete_resets_to_default_or_throws_unsupported', () => {
    it('throws since the AI settings singleton cannot be deleted', async () => {
      await expect(provider.applyItemDelete('ai-settings')).rejects.toThrow(/cannot delete singleton/i);
    });
  });

  describe('subscribeToChanges_emits_when_settings_change', () => {
    it('emits an upsert event when settingsService notifies', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      const { settingsService } = await import('../../../services/settings/settingsService.svelte');
      (settingsService as unknown as { __emit: () => void }).__emit();

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toEqual({ type: 'upsert', itemId: 'ai-settings', categoryId: 'ai-settings' });
      unsub();
    });
  });
});
