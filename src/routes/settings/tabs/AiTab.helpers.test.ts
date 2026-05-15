import { describe, it, expect } from 'vitest';
import { availableProvidersForNewRow, canTestAndFetch } from './AiTab.helpers';
import type { IProviderPlugin, ProviderConfig } from '../../../services/ai/IProviderPlugin';

function makePlugin(
  id: string,
  opts: Partial<IProviderPlugin> = {},
): IProviderPlugin {
  return {
    id: id as IProviderPlugin['id'],
    name: id,
    requiresApiKey: false,
    requiresBaseUrl: false,
    getModels: async () => [],
    buildRequest: () => ({ url: '', headers: {}, body: null }),
    parseStream: async function* () {},
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
    expect(
      canTestAndFetch(plugin, { enabled: true, baseUrl: 'http://localhost:11434' }),
    ).toBe(true);
  });

  it('returns true for Custom (requiresBaseUrl + optionalApiKey) even when apiKey is absent', () => {
    const plugin = makePlugin('custom', {
      requiresBaseUrl: true,
      optionalApiKey: true,
    });
    expect(
      canTestAndFetch(plugin, { enabled: true, baseUrl: 'https://api.example.com' }),
    ).toBe(true);
  });
});
