import { describe, it, expect } from 'vitest';
import {
  availableProvidersForNewRow,
  canTestAndFetch,
  configForNewProvider,
  modelSelectionAfterFetch,
  reasoningEffortAfterModelChange,
  reasoningEffortsForModel,
} from './AiTab.helpers';
import type { IProviderPlugin, ProviderConfig } from '../../../services/ai/IProviderPlugin';

function makePlugin(id: string, opts: Partial<IProviderPlugin> = {}): IProviderPlugin {
  return {
    id: id as IProviderPlugin['id'],
    name: id,
    requiresApiKey: false,
    requiresBaseUrl: false,
    getModels: async () => [],
    ...opts,
  };
}

// ── availableProvidersForNewRow ────────────────────────────────────────────────

describe('availableProvidersForNewRow', () => {
  it('returns all plugins when none are in the existing set', () => {
    const plugins = [makePlugin('openai'), makePlugin('anthropic'), makePlugin('ollama')];
    const result = availableProvidersForNewRow(plugins, []);
    expect(result.map((p) => p.id)).toEqual(['openai', 'anthropic', 'ollama']);
  });

  it('filters out plugins that are already in the existing set', () => {
    const plugins = [makePlugin('openai'), makePlugin('anthropic'), makePlugin('ollama')];
    const result = availableProvidersForNewRow(plugins, ['openai', 'ollama']);
    expect(result.map((p) => p.id)).toEqual(['anthropic']);
  });

  it('returns empty array when all plugins are already added', () => {
    const plugins = [makePlugin('openai'), makePlugin('anthropic')];
    const result = availableProvidersForNewRow(plugins, ['openai', 'anthropic']);
    expect(result).toHaveLength(0);
  });
});

// ── canTestAndFetch ────────────────────────────────────────────────────────────

describe('canTestAndFetch', () => {
  it('returns false when plugin is null', () => {
    expect(canTestAndFetch(null, { enabled: true })).toBe(false);
  });

  it('returns false for OpenAI (requiresApiKey) when apiKey is missing', () => {
    const plugin = makePlugin('openai', { requiresApiKey: true });
    expect(canTestAndFetch(plugin, { enabled: true })).toBe(false);
    expect(canTestAndFetch(plugin, { enabled: true, apiKey: '  ' })).toBe(false);
  });

  it('returns true for Ollama (requiresBaseUrl, no apiKey) when baseUrl is set', () => {
    const plugin = makePlugin('ollama', { requiresBaseUrl: true });
    expect(canTestAndFetch(plugin, { enabled: true, baseUrl: 'http://localhost:11434' })).toBe(
      true,
    );
  });

  it('returns true for Custom (requiresBaseUrl + optionalApiKey) even when apiKey is absent', () => {
    const plugin = makePlugin('custom', {
      requiresBaseUrl: true,
      optionalApiKey: true,
    });
    expect(canTestAndFetch(plugin, { enabled: true, baseUrl: 'https://api.example.com' })).toBe(
      true,
    );
  });
});

describe('configForNewProvider', () => {
  it('explicitly selects Responses for a newly added compatible provider', () => {
    const plugin = makePlugin('custom', { supportsOpenAIApiMode: true });

    expect(configForNewProvider(plugin, { enabled: false })).toEqual({
      enabled: true,
      openAIApiMode: 'responses',
    });
  });

  it('does not add an API mode to other provider families', () => {
    expect(configForNewProvider(makePlugin('anthropic'), { enabled: false })).toEqual({
      enabled: true,
    });
  });
});

describe('reasoningEffortsForModel', () => {
  const plugin = makePlugin('openrouter', {
    reasoningEfforts: ['none', 'low', 'medium', 'high'],
  });

  it('falls back to provider-family levels without model metadata', () => {
    expect(reasoningEffortsForModel(plugin, [], 'custom-model')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ]);
  });

  it('uses model-specific levels when available', () => {
    expect(
      reasoningEffortsForModel(
        plugin,
        [{ id: 'reasoning-model', label: 'Reasoning', reasoningEfforts: ['low', 'high'] }],
        'reasoning-model',
      ),
    ).toEqual(['low', 'high']);
  });

  it('preserves an explicit empty list for a non-reasoning model', () => {
    expect(
      reasoningEffortsForModel(
        plugin,
        [{ id: 'plain-model', label: 'Plain', reasoningEfforts: [] }],
        'plain-model',
      ),
    ).toEqual([]);
  });

  it('clears an effort that the newly selected model does not support', () => {
    expect(
      reasoningEffortAfterModelChange(
        plugin,
        [{ id: 'narrow-model', label: 'Narrow', reasoningEfforts: ['low'] }],
        'narrow-model',
        'high',
      ),
    ).toBeUndefined();
  });

  it('keeps an effort supported by the newly selected model', () => {
    expect(
      reasoningEffortAfterModelChange(
        plugin,
        [{ id: 'narrow-model', label: 'Narrow', reasoningEfforts: ['low'] }],
        'narrow-model',
        'low',
      ),
    ).toBe('low');
  });
});

// ── modelSelectionAfterFetch ───────────────────────────────────────────────────

describe('modelSelectionAfterFetch', () => {
  const plugin = makePlugin('ollama');
  const models = [
    { id: 'llama3.2', label: 'Llama 3.2' },
    { id: 'qwen2.5', label: 'Qwen 2.5' },
  ];

  it('adopts the first fetched model when none is selected yet', () => {
    // The <select> only shows the first model — it never fires onchange, so the
    // config must be seeded here or the ★ default button stays disabled.
    const result = modelSelectionAfterFetch(plugin, models, { enabled: true });
    expect(result.configPatch.lastModelId).toBe('llama3.2');
    expect(result.newlySelectedModelId).toBe('llama3.2');
  });

  it('keeps the user-chosen model and does not re-trigger auto-default', () => {
    const result = modelSelectionAfterFetch(plugin, models, {
      enabled: true,
      lastModelId: 'qwen2.5',
    });
    expect(result.configPatch.lastModelId).toBeUndefined();
    expect(result.newlySelectedModelId).toBeUndefined();
  });

  it('makes no selection when the provider returns no models', () => {
    const result = modelSelectionAfterFetch(plugin, [], { enabled: true });
    expect(result.configPatch.lastModelId).toBeUndefined();
    expect(result.newlySelectedModelId).toBeUndefined();
  });

  it('clears a reasoning effort the auto-selected model does not support', () => {
    const reasoningPlugin = makePlugin('ollama', { reasoningEfforts: ['low', 'high'] });
    const result = modelSelectionAfterFetch(
      reasoningPlugin,
      [{ id: 'plain', label: 'Plain', reasoningEfforts: [] }],
      { enabled: true, reasoningEffort: 'high' },
    );
    expect(result.configPatch.reasoningEffort).toBeUndefined();
    expect('reasoningEffort' in result.configPatch).toBe(true);
  });
});
