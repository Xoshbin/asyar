import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AISettingsSyncProvider } from './aiSettingsSyncProvider';
import type { SyncProviderData } from '../types';

const mockSettings = {
  provider: 'openai',
  apiKey: 'sk-secret',
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 2048,
};

vi.mock('../../../built-in-features/ai-chat/aiStore.svelte', () => ({
  aiStore: { settings: { provider: 'openai', apiKey: 'sk-secret', model: 'gpt-4o', temperature: 0.7, maxTokens: 2048 } },
}));

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
    expect(provider.sensitiveFields).toEqual(['apiKey']);
  });

  it('exportFull returns current AI settings', async () => {
    const result = await provider.exportFull();
    expect(result.providerId).toBe('ai-settings');
    expect(result.version).toBe(1);
    expect(result.data).toMatchObject(mockSettings);
    expect(result.binaryAssets).toBeUndefined();
  });

  it('preview returns 1/1', async () => {
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 1,
      exportedAt: Date.now(),
      data: { provider: 'anthropic', apiKey: 'sk-other', model: 'claude-3', temperature: 1.0, maxTokens: 4096 },
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
    const newSettings = { provider: 'anthropic', apiKey: 'sk-other', model: 'claude-3', temperature: 1.0, maxTokens: 4096 };
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 1,
      exportedAt: Date.now(),
      data: newSettings,
    };

    const result = await provider.applyImport(incoming, 'replace');
    expect(result.success).toBe(true);
    expect(result.itemsUpdated).toBe(1);
    expect(aiStore.settings).toMatchObject(newSettings);
  });

  it('applyImport skip — does nothing', async () => {
    const { aiStore } = await import('../../../built-in-features/ai-chat/aiStore.svelte');
    const originalProvider = aiStore.settings.provider;
    const incoming: SyncProviderData = {
      providerId: 'ai-settings',
      version: 1,
      exportedAt: Date.now(),
      data: { provider: 'anthropic', apiKey: 'sk-other', model: 'claude-3', temperature: 1.0, maxTokens: 4096 },
    };

    const result = await provider.applyImport(incoming, 'skip');
    expect(result.itemsAdded).toBe(0);
    expect(result.itemsUpdated).toBe(0);
    expect(aiStore.settings.provider).toBe(originalProvider);
  });

  it('getLocalSummary returns "AI settings"', async () => {
    const summary = await provider.getLocalSummary();
    expect(summary.itemCount).toBe(1);
    expect(summary.label).toBe('AI settings');
  });
});
