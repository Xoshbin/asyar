import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AISettingsSyncProvider } from './aiSettingsSyncProvider';
import type { SyncProviderData } from '../types';

const mockAiSaveCredential = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../lib/ipc/commands', () => ({
  aiSaveCredential: mockAiSaveCredential,
}));
vi.mock('../../../services/log/logService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockAiSettings = vi.hoisted(() => ({
  providers: {
    openai: { enabled: true },
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
  webSearch: {
    engine: 'duckduckgo' as const,
  },
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
    expect(provider.sensitiveFields).toEqual([]);
  });

  it('exportFull returns current AI settings without any apiKey', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('ai-settings');
    expect(result.version).toBe(2);
    expect(result.data).toMatchObject({ temperature: 0.7 });
    expect(result.binaryAssets).toBeUndefined();
    const data = result.data as Record<string, any>;
    expect(data.providers.openai).not.toHaveProperty('apiKey');
    expect(data.webSearch).not.toHaveProperty('apiKey');
  });

  it('exportFull explicitly strips any apiKey found in providers or webSearch', async () => {
    (mockAiSettings.providers as any).openai.apiKey = 'sk-dirty-key';
    (mockAiSettings as any).webSearch.apiKey = 'dirty-search-key';

    const result = await provider.exportFull();
    const data = result.data as Record<string, any>;
    expect(data.providers.openai).not.toHaveProperty('apiKey');
    expect(data.webSearch).not.toHaveProperty('apiKey');

    delete (mockAiSettings.providers as any).openai.apiKey;
    delete (mockAiSettings as any).webSearch.apiKey;
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
    const providers = (result.data as Record<string, unknown>).providers as Record<
      string,
      Record<string, unknown>
    >;
    expect(providers['openai']).not.toHaveProperty('apiKey');
  });

  it('old-export fixture: imports legacy apiKey into aiSaveCredential and deletes from updateSettings payload', async () => {
    // COMPAT(remove in 0.2.0): old .asyar exports carry apiKey
    const oldExportData: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: 123456789,
      data: {
        providers: {
          openai: { enabled: true, apiKey: 'sk-ant-test-provider-key' },
          custom: { enabled: true, apiKey: null },
          ollama: { enabled: true, apiKey: '   ' },
        },
        webSearch: {
          engine: 'brave',
          apiKey: 'brave-search-key-123',
        },
        temperature: 0.8,
        maxTokens: 1024,
      },
    };

    const res = await provider.applyImport(oldExportData, 'replace');
    expect(res.success).toBe(true);
    expect(res.warnings).toEqual([]);

    // Stored keys must be forwarded to aiSaveCredential
    expect(mockAiSaveCredential).toHaveBeenCalledWith(
      { type: 'provider', id: 'openai' },
      'sk-ant-test-provider-key',
    );
    expect(mockAiSaveCredential).toHaveBeenCalledWith(
      { type: 'webSearch', engine: 'brave' },
      'brave-search-key-123',
    );
    // null and empty keys must NOT be saved
    expect(mockAiSaveCredential).not.toHaveBeenCalledWith(
      { type: 'provider', id: 'custom' },
      expect.anything(),
    );
    expect(mockAiSaveCredential).not.toHaveBeenCalledWith(
      { type: 'provider', id: 'ollama' },
      expect.anything(),
    );

    // Plaintext apiKey must NEVER reach updateSettings
    const updated = mockUpdateSettings.mock.calls[0][1];
    expect(updated.providers.openai).not.toHaveProperty('apiKey');
    expect(updated.providers.custom).not.toHaveProperty('apiKey');
    expect(updated.providers.ollama).not.toHaveProperty('apiKey');
    expect(updated.webSearch).not.toHaveProperty('apiKey');
    expect(updated.webSearch.engine).toBe('brave');
  });

  it("old-export fixture: a web-search key is saved for the export's own engine", async () => {
    // COMPAT(remove in 0.2.0): old .asyar exports carry apiKey
    const res = await provider.applyImport(
      {
        providerId: 'ai-settings',
        version: 2,
        exportedAt: 1,
        data: { webSearch: { engine: 'tavily', apiKey: 'tvly-key' } },
      },
      'replace',
    );

    expect(res.warnings).toEqual([]);
    expect(mockAiSaveCredential).toHaveBeenCalledTimes(1);
    expect(mockAiSaveCredential).toHaveBeenCalledWith(
      { type: 'webSearch', engine: 'tavily' },
      'tvly-key',
    );
    expect(mockUpdateSettings.mock.calls[0][1].webSearch).toEqual({ engine: 'tavily' });
  });

  it.each(['duckduckgo', 'searxng', undefined])(
    'old-export fixture: a web-search key with engine %s is skipped with a warning',
    async (engine) => {
      // COMPAT(remove in 0.2.0): old .asyar exports carry apiKey
      const res = await provider.applyImport(
        {
          providerId: 'ai-settings',
          version: 2,
          exportedAt: 1,
          data: { webSearch: { ...(engine ? { engine } : {}), apiKey: 'orphan-key' } },
        },
        'replace',
      );

      expect(mockAiSaveCredential).not.toHaveBeenCalled();
      expect(res.warnings).toEqual(["some API keys couldn't be imported; please re-enter them"]);
      expect(mockUpdateSettings.mock.calls[0][1].webSearch).not.toHaveProperty('apiKey');
    },
  );

  it('old-export fixture: null providers/webSearch (password-less export) never reach updateSettings', async () => {
    // COMPAT(remove in 0.2.0): old unencrypted exports wrote `providers: null`
    const res = await provider.applyImport(
      {
        providerId: 'ai-settings',
        version: 2,
        exportedAt: 1,
        data: { providers: null, webSearch: null, temperature: 0.9, maxTokens: 512 },
      },
      'replace',
    );

    expect(res.success).toBe(true);
    const updated = mockUpdateSettings.mock.calls[0][1];
    expect('providers' in updated).toBe(false);
    expect('webSearch' in updated).toBe(false);
    expect(updated.maxTokens).toBe(512);
    expect(mockAiSaveCredential).not.toHaveBeenCalled();
  });

  it('reports warning and continues when credential save fails during import', async () => {
    mockAiSaveCredential.mockRejectedValueOnce(new Error('keystore locked'));

    const oldExportData: SyncProviderData = {
      providerId: 'ai-settings',
      version: 2,
      exportedAt: 123456789,
      data: {
        providers: {
          openai: { enabled: true, apiKey: 'sk-fail-key' },
          anthropic: { enabled: true, apiKey: 'sk-success-key' },
        },
      },
    };

    const res = await provider.applyImport(oldExportData, 'replace');
    expect(res.success).toBe(true);
    expect(res.warnings).toEqual(["some API keys couldn't be imported; please re-enter them"]);

    // Both saves were attempted
    expect(mockAiSaveCredential).toHaveBeenCalledWith(
      { type: 'provider', id: 'openai' },
      'sk-fail-key',
    );
    expect(mockAiSaveCredential).toHaveBeenCalledWith(
      { type: 'provider', id: 'anthropic' },
      'sk-success-key',
    );

    // Neither key leaked into updateSettings
    const updated = mockUpdateSettings.mock.calls[0][1];
    expect(updated.providers.openai).not.toHaveProperty('apiKey');
    expect(updated.providers.anthropic).not.toHaveProperty('apiKey');
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
      }),
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
      }),
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
    it('hands the sanitized settings object to settingsService.updateSettings without providers', async () => {
      const newSettings = { ...mockAiSettings };
      await provider.applyItemUpsert({
        id: 'ai-settings',
        categoryId: 'ai-settings',
        content: newSettings,
      });
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        'ai',
        expect.not.objectContaining({ providers: expect.anything() }),
      );
    });

    it('pulling an ai-settings item with webSearch {engine: "brave"} merges webSearch', async () => {
      await provider.applyItemUpsert({
        id: 'ai-settings',
        categoryId: 'ai-settings',
        content: {
          webSearch: {
            engine: 'brave',
          },
        },
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith('ai', {
        webSearch: {
          engine: 'brave',
        },
      });
    });

    it('pulling an ai-settings item that contains webSearch.apiKey and providers.x.apiKey ignores both and keeps local values', async () => {
      await provider.applyItemUpsert({
        id: 'ai-settings',
        categoryId: 'ai-settings',
        content: {
          providers: {
            openai: { enabled: true, apiKey: 'sk-or-TEST-REMOTE-PROVIDER' },
          },
          webSearch: {
            engine: 'tavily',
            apiKey: 'sk-or-TEST-REMOTE-SEARCH',
          },
          temperature: 0.9,
        } as any,
      });

      const calledWith = mockUpdateSettings.mock.calls[0]?.[1] as Record<string, unknown>;
      // providers key must be ignored completely
      expect(calledWith).not.toHaveProperty('providers');
      // webSearch engine updated to tavily, but apiKey is stripped
      expect(calledWith.webSearch).toEqual({
        engine: 'tavily',
      });
      // other non-sensitive fields sync normally
      expect(calledWith.temperature).toBe(0.9);
    });
  });

  describe('applyItemDelete_resets_to_default_or_throws_unsupported', () => {
    it('throws since the AI settings singleton cannot be deleted', async () => {
      await expect(provider.applyItemDelete('ai-settings')).rejects.toThrow(
        /cannot delete singleton/i,
      );
    });
  });

  describe('subscribeToChanges_emits_when_settings_change', () => {
    it('emits an upsert event when settingsService notifies', async () => {
      const events: Array<{ type: string; itemId: string; categoryId: string }> = [];
      const unsub = provider.subscribeToChanges((ev) => events.push(ev));

      const { settingsService } = await import('../../../services/settings/settingsService.svelte');
      (settingsService as unknown as { __emit: () => void }).__emit();

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toEqual({
        type: 'upsert',
        itemId: 'ai-settings',
        categoryId: 'ai-settings',
      });
      unsub();
    });
  });
});
