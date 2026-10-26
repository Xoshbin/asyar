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
  it("fetches a provider's models once, by its provider type", async () => {
    const list = vi.fn().mockResolvedValue([{ id: 'm', label: 'M' }]);
    const catalog = new ModelCatalog(list);
    const config = { enabled: true, providerType: 'anthropic' as const };

    await catalog.load('work', config);
    await catalog.load('work', config);

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith('anthropic', config);
    expect(catalog.models.work).toEqual([{ id: 'm', label: 'M' }]);
    expect(catalog.loading.work).toBe(false);
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
