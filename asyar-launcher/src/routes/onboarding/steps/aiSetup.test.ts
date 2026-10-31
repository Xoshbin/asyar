import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateSettings = vi.hoisted(() => vi.fn());
const upsertDefaultAgent = vi.hoisted(() => vi.fn());
const aiDeleteCredential = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ providers: {} as Record<string, Record<string, unknown>> }));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    get currentSettings() {
      return { ai: { providers: state.providers } };
    },
    updateSettings,
  },
}));

vi.mock('../../../built-in-features/agents/agentService.svelte', () => ({
  agentService: { upsertDefaultAgent },
}));

vi.mock('../../../lib/ipc/agentCommands', () => ({ aiDeleteCredential }));

import { connectCliProvider } from './aiSetup';

const OTHER = { enabled: true, connectionMode: 'api', lastModelId: 'existing-model' };

function savedProviders(): Record<string, Record<string, unknown>> {
  return updateSettings.mock.calls[0][1].providers;
}

describe('connectCliProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.providers = { existing: { ...OTHER } };
  });

  it('keeps every existing field of the provider and sets the four CLI fields', async () => {
    state.providers.openai = {
      enabled: false,
      connectionMode: 'api',
      baseUrl: 'https://proxy.example.com/v1',
      reasoningEffort: 'high',
      customField: 'keep-me',
      lastModelId: 'gpt-4o',
    };

    await connectCliProvider(
      { id: 'openai', defaultModel: 'gpt-5-codex' },
      { path: '/usr/local/bin/codex' },
    );

    expect(savedProviders().openai).toEqual({
      baseUrl: 'https://proxy.example.com/v1',
      reasoningEffort: 'high',
      customField: 'keep-me',
      enabled: true,
      connectionMode: 'cli',
      cliBinaryPath: '/usr/local/bin/codex',
      lastModelId: 'gpt-5-codex',
    });
  });

  it('gives a provider that did not exist before just the four CLI fields', async () => {
    await connectCliProvider(
      { id: 'openai', defaultModel: 'gpt-5-codex' },
      { path: '/usr/local/bin/codex' },
    );

    expect(savedProviders().openai).toEqual({
      enabled: true,
      connectionMode: 'cli',
      cliBinaryPath: '/usr/local/bin/codex',
      lastModelId: 'gpt-5-codex',
    });
  });

  it('keeps an earlier saved binary path when the probe finds none', async () => {
    state.providers.openai = { cliBinaryPath: '/opt/custom/codex', baseUrl: 'https://x' };

    await connectCliProvider({ id: 'openai', defaultModel: 'gpt-5-codex' }, { path: null });

    expect(savedProviders().openai.cliBinaryPath).toBe('/opt/custom/codex');
  });

  it('does not write an undefined binary path when there is nothing to keep', async () => {
    await connectCliProvider({ id: 'openai', defaultModel: 'gpt-5-codex' }, { path: null });

    expect(savedProviders().openai).not.toHaveProperty('cliBinaryPath');
  });

  it('leaves other providers untouched', async () => {
    await connectCliProvider(
      { id: 'openai', defaultModel: 'gpt-5-codex' },
      { path: '/usr/local/bin/codex' },
    );

    expect(savedProviders().existing).toEqual(OTHER);
  });

  it('never deletes a saved credential', async () => {
    state.providers.openai = { connectionMode: 'api' };

    await connectCliProvider(
      { id: 'openai', defaultModel: 'gpt-5-codex' },
      { path: '/usr/local/bin/codex' },
    );

    expect(aiDeleteCredential).not.toHaveBeenCalled();
  });

  it('makes the CLI model the default agent', async () => {
    await connectCliProvider(
      { id: 'openai', defaultModel: 'gpt-5-codex' },
      { path: '/usr/local/bin/codex' },
    );

    expect(upsertDefaultAgent).toHaveBeenCalledWith('openai', 'gpt-5-codex');
  });
});
