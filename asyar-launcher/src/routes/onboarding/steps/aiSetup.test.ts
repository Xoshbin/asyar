import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateSettings = vi.hoisted(() => vi.fn());
const upsertDefaultAgent = vi.hoisted(() => vi.fn());

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        providers: {
          existing: { enabled: true, connectionMode: 'api', lastModelId: 'existing-model' },
        },
      },
    },
    updateSettings,
  },
}));

vi.mock('../../../built-in-features/agents/agentService.svelte', () => ({
  agentService: { upsertDefaultAgent },
}));

import { connectCliProvider } from './aiSetup';

describe('connectCliProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the CLI provider and makes its model the default agent', async () => {
    await connectCliProvider(
      { id: 'openai', defaultModel: 'gpt-5-codex' },
      { installed: true, path: '/usr/local/bin/codex' },
    );

    expect(updateSettings).toHaveBeenCalledWith('ai', {
      providers: {
        existing: { enabled: true, connectionMode: 'api', lastModelId: 'existing-model' },
        openai: {
          enabled: true,
          connectionMode: 'cli',
          cliBinaryPath: '/usr/local/bin/codex',
          lastModelId: 'gpt-5-codex',
        },
      },
    });
    expect(upsertDefaultAgent).toHaveBeenCalledWith('openai', 'gpt-5-codex');
  });
});
