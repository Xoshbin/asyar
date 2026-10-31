import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({ aiListModels: vi.fn() }));

import {
  ModelCatalog,
  filterOptions,
  modelForProvider,
  modelOptions,
  providerOptions,
} from './modelCatalog.svelte';

const plugins = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'google', name: 'Google Gemini' },
];

describe('providerOptions', () => {
  it('lists the enabled providers, labelled like the AI settings rows', () => {
    expect(
      providerOptions(
        {
          anthropic: { enabled: true },
          work: { enabled: true, providerType: 'anthropic', name: 'Work' },
          google: { enabled: false },
        },
        plugins,
      ),
    ).toEqual([
      { id: 'anthropic', label: 'Anthropic' },
      { id: 'work', label: 'Work' },
    ]);
  });
});

describe('providerOptions credential filter', () => {
  const keyed = [
    { id: 'anthropic', name: 'Anthropic', requiresApiKey: true },
    { id: 'ollama', name: 'Ollama', requiresApiKey: false },
  ];
  const providers = {
    anthropic: { enabled: true },
    work: { enabled: true, providerType: 'anthropic' as const, name: 'Work' },
    cli: {
      enabled: true,
      providerType: 'anthropic' as const,
      name: 'CLI',
      connectionMode: 'cli' as const,
    },
    ollama: { enabled: true },
  };
  const ids = (options: { id: string }[]) => options.map((o) => o.id);

  it('hides API-mode providers that need a key and lack a configured one', () => {
    const states = {
      anthropic: 'configured',
      work: 'notConfigured',
      cli: 'notConfigured',
      ollama: 'notConfigured',
    } as const;
    expect(ids(providerOptions(providers, keyed, states))).toEqual(['anthropic', 'cli', 'ollama']);
  });

  it('hides a provider whose key needs re-entry', () => {
    const states = { anthropic: 'needsReentry', work: 'configured' } as const;
    expect(ids(providerOptions(providers, keyed, states))).toEqual(['work', 'cli', 'ollama']);
  });

  it('lists every enabled provider while the credential states are unknown', () => {
    expect(ids(providerOptions(providers, keyed, null))).toEqual([
      'anthropic',
      'work',
      'cli',
      'ollama',
    ]);
  });

  it('keeps the provider already in use even when it is hidden', () => {
    expect(ids(providerOptions(providers, keyed, {}, 'work'))).toEqual(['work', 'cli', 'ollama']);
  });
});

describe('modelOptions', () => {
  const models = [
    { id: 'opus', label: 'Claude Opus' },
    { id: 'sonnet', label: 'Claude Sonnet' },
  ];

  it("lists one provider's models", () => {
    expect(modelOptions(models, 'sonnet')).toEqual([
      { id: 'opus', label: 'Claude Opus' },
      { id: 'sonnet', label: 'Claude Sonnet' },
    ]);
  });

  it('keeps the model in use listed when the provider list lacks it', () => {
    expect(modelOptions(models, 'custom-1')[0]).toEqual({ id: 'custom-1', label: 'custom-1' });
    expect(modelOptions([], 'custom-1')).toEqual([{ id: 'custom-1', label: 'custom-1' }]);
  });

  it('lists nothing while a provider has no models yet', () => {
    expect(modelOptions([], null)).toEqual([]);
  });
});

describe('filterOptions', () => {
  const options = [
    { id: 'claude-sonnet', label: 'Claude Sonnet' },
    { id: 'claude-opus', label: 'Claude Opus' },
  ];

  it('matches every word against the label and id', () => {
    expect(filterOptions(options, 'son')).toEqual([options[0]]);
    expect(filterOptions(options, 'claude opus')).toEqual([options[1]]);
    expect(filterOptions(options, 'claude-opus')).toEqual([options[1]]);
    expect(filterOptions(options, 'gemini')).toEqual([]);
  });

  it('returns everything for an empty query', () => {
    expect(filterOptions(options, '  ')).toEqual(options);
  });
});

describe('modelForProvider', () => {
  const agent = { providerId: 'anthropic', modelId: 'sonnet' };

  it("prefers the provider's last-used model", () => {
    expect(
      modelForProvider('anthropic', { anthropic: { enabled: true, lastModelId: 'opus' } }, agent),
    ).toBe('opus');
  });

  it("falls back to the agent's model when the agent is on that provider", () => {
    expect(modelForProvider('anthropic', { anthropic: { enabled: true } }, agent)).toBe('sonnet');
  });

  it('is null when no model is known, so the user picks one', () => {
    expect(modelForProvider('google', { google: { enabled: true } }, agent)).toBeNull();
  });
});

describe('ModelCatalog', () => {
  it("fetches a provider's models once, by its instance id", async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'm', label: 'M' }]);
    const catalog = new ModelCatalog(list);
    const config = { enabled: true, providerType: 'anthropic' as const };

    await catalog.load('work', config);
    await catalog.load('work', config);

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith('work', config);
    expect(catalog.models.work).toEqual([{ id: 'm', label: 'M' }]);
    expect(catalog.loading.work).toBe(false);
  });

  it('passes the instance id, not the provider type, so the right key is used', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const config = { enabled: true, providerType: 'openai' as const };

    await new ModelCatalog(list).load('work', config);

    expect(list).toHaveBeenCalledWith('work', config);
    expect(list).not.toHaveBeenCalledWith('openai', expect.anything());
  });

  it('records a failure instead of throwing, and retries on the next load', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('no key'));
    const catalog = new ModelCatalog(list);
    const config = { enabled: true };

    await catalog.load('google', config);
    expect(catalog.errors.google).toBe('no key');
    expect(catalog.models.google).toBeUndefined();

    list.mockResolvedValue([{ id: 'g', label: 'G' }]);
    await catalog.load('google', config);
    expect(catalog.models.google).toHaveLength(1);
    expect(catalog.errors.google).toBeUndefined();
  });

  it('does nothing for a provider without a config', async () => {
    const list = vi.fn();
    await new ModelCatalog(list).load('gone', undefined);
    expect(list).not.toHaveBeenCalled();
  });
});
