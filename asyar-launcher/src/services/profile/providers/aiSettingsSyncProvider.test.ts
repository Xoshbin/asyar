import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AISettingsSyncProvider } from './aiSettingsSyncProvider';
import type { SyncProviderData } from '../types';

const mockAiSettings = vi.hoisted(() => ({
  providers: {
    openai: { enabled: true, apiKey: 'sk-secret' },
    anthropic: { enabled: false },
    google: { enabled: false },
    ollama: { enabled: false },
    openrouter: { enabled: false },
    custom: { enabled: false },
  },
  temperature: 0.7,
  maxTokens: 2048,
  defaultAgentId: 'agent-abc',
  tabContinuesLastThread: true,
}));

const mockUpdateSettings = vi.hoisted(() => vi.fn());

vi.mock('../../../services/settings/settingsService.svelte', () => {
  const subscribers = new Set<() => void>();
  return {
    settingsService: {
      get currentSettings() {
        return { ai: { ...mockAiSettings } };
      },
      updateSettings: mockUpdateSettings,
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
    expect(result.data).toMatchObject({ temperature: 0.7 });
    expect(result.binaryAssets).toBeUndefined();
  });

  it('export snapshot contains only the new AI settings shape', async () => {
    const result = await provider.exportForSync();
    const data = result.data as Record<string, unknown>;
    // new keys must be present
    expect(data).toHaveProperty('providers');
    expect(data).toHaveProperty('temperature');
    expect(data).toHaveProperty('maxTokens');
    expect(data).toHaveProperty('defaultAgentId');
    expect(data).toHaveProperty('tabContinuesLastThread');
    // legacy keys must NOT be present in the exported snapshot
    expect(data).not.toHaveProperty('activeProviderId');
    expect(data).not.toHaveProperty('activeModelId');
    expect(data).not.toHaveProperty('systemPrompt');
    expect(data).not.toHaveProperty('allowExtensionUse');
  });

  it('export snapshot strips per-provider apiKey for safety', async () => {
    const result = await provider.exportForSync();
    const providers = (result.data as Record<string, unknown>).providers as Record<string, Record<string, unknown>>;
    expect(providers['openai']).not.toHaveProperty('apiKey');
  });

  it('import snapshot writes defaultAgentId and tabContinuesLastThread into settings', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: {
        providers: {},
        temperature: 0.5,
        maxTokens: 1024,
        defaultAgentId: 'agent-xyz',
        tabContinuesLastThread: true,
      },
    };

    await provider.applyImport(incoming, 'replace');

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      'ai',
      expect.objectContaining({
        defaultAgentId: 'agent-xyz',
        tabContinuesLastThread: true,
      })
    );
  });

  it('import snapshot ignores legacy keys — does not call updateSettings with legacy fields', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: {
        providers: {},
        temperature: 0.5,
        maxTokens: 1024,
        defaultAgentId: null,
        tabContinuesLastThread: false,
        activeProviderId: 'openai',
        activeModelId: 'gpt-4o',
        systemPrompt: 'Be helpful',
        allowExtensionUse: true,
      },
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(result.success).toBe(true);
    const calledWith = mockUpdateSettings.mock.calls[0]?.[1] as Record<string, unknown>;
    // Legacy keys must not be forwarded
    expect(calledWith).not.toHaveProperty('activeProviderId');
    expect(calledWith).not.toHaveProperty('activeModelId');
    expect(calledWith).not.toHaveProperty('systemPrompt');
    expect(calledWith).not.toHaveProperty('allowExtensionUse');
  });

  it('preview returns 1/1', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: { ...mockAiSettings },
    };

    const preview = await provider.preview(incoming);
    expect(preview.localCount).toBe(1);
    expect(preview.incomingCount).toBe(1);
    expect(preview.conflicts).toBe(1);
    expect(preview.newItems).toBe(0);
    expect(preview.removedItems).toBe(0);
  });

  it('applyImport replace — updates settings', async () => {
    const newSettings = { ...mockAiSettings };
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: newSettings,
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(result.success).toBe(true);
    expect(result.itemsUpdated).toBe(1);
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      'ai',
      expect.objectContaining({
        providers: newSettings.providers,
        temperature: newSettings.temperature,
        maxTokens: newSettings.maxTokens,
        defaultAgentId: newSettings.defaultAgentId,
        tabContinuesLastThread: newSettings.tabContinuesLastThread,
      })
    );
  });

  it('applyImport skip — does nothing', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: Date.now(),
      data: { ...mockAiSettings },
    };

    const result = await provider.applyImport(incoming, 'skip');
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
    expect(mockUpdateSettings).not.toHaveBeenCalled();
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
      expect(items[0].content).toMatchObject({ temperature: 0.7, maxTokens: 2048 });
    });
  });

  describe('applyItemUpsert_writes_full_state', () => {
    it('hands the full settings object to settingsService.updateSettings', async () => {
      const newSettings = { ...mockAiSettings };
      await provider.applyItemUpsert({ id: 'ai-settings', categoryId: 'ai-settings', content: newSettings });
      expect(mockUpdateSettings).toHaveBeenCalledWith('ai', newSettings);
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
