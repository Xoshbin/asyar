// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components', async () => ({
  Button: (await import('../../../components/base/Button.svelte')).default,
  Input: (await import('../../../components/base/Input.svelte')).default,
  InlineError: (await import('../../../components/feedback/InlineError.svelte')).default,
  EmptyState: (await import('../../../components/feedback/EmptyState.svelte')).default,
  SettingsForm: (await import('../../../components/settings/SettingsForm.svelte')).default,
  SettingsFormRow: (await import('../../../components/settings/SettingsFormRow.svelte')).default,
  SettingsCard: (await import('../../../components/settings/SettingsCard.svelte')).default,
  Toggle: (await import('../../../components/base/Toggle.svelte')).default,
}));
vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        providers: {
          anthropic: { enabled: true, apiKey: 'sk-ant', lastModelId: 'claude-sonnet-5' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },
    },
    updateSettings: vi.fn(),
  },
}));
vi.mock('../../../services/ai/providerRegistry', () => ({
  providerRegistry: {
    list: vi.fn().mockReturnValue([
      {
        id: 'anthropic',
        name: 'Anthropic',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: vi.fn(),
      },
    ]),
  },
}));
vi.mock('../../../built-in-features/agents/agentService.svelte', () => ({
  agentService: {
    init: vi.fn().mockResolvedValue(undefined),
    getDefaultAgent: vi.fn().mockReturnValue(null),
    upsertDefaultAgent: vi.fn(),
  },
}));
vi.mock('../../../lib/ipc/commands', () => ({
  agentsProviderRemovalBlockers: vi.fn(),
}));

import AiTab from './AiTab.svelte';
import { agentsProviderRemovalBlockers } from '../../../lib/ipc/commands';
import { settingsService } from '../../../services/settings/settingsService.svelte';
import { providerRegistry } from '../../../services/ai/providerRegistry';

describe('AiTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks removing the last usable provider and shows why', async () => {
    vi.mocked(agentsProviderRemovalBlockers).mockResolvedValue(
      "Can't remove Anthropic — it's the last configured provider and these agents still use it: Asyar Assistant. Reassign or delete them first.",
    );

    render(AiTab, { mode: 'providers-only' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Anthropic' }));

    expect(await screen.findByText(/Can't remove Anthropic.*Asyar Assistant/)).toBeTruthy();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('removes a provider immediately when nothing blocks it', async () => {
    vi.mocked(agentsProviderRemovalBlockers).mockResolvedValue(null);

    render(AiTab, { mode: 'providers-only' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Anthropic' }));

    await vi.waitFor(() => {
      expect(settingsService.updateSettings).toHaveBeenCalledWith(
        'ai',
        expect.objectContaining({
          providers: {},
        }),
      );
    });
  });

  it('renders custom connection name and provider type badge', () => {
    vi.mocked(settingsService).currentSettings = {
      ai: {
        providers: {
          custom_1: {
            enabled: true,
            name: 'Local Ollama',
            providerType: 'custom' as any,
            baseUrl: 'http://localhost:11434',
          },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },
    } as any;
    vi.mocked(providerRegistry.list).mockReturnValue([
      {
        id: 'custom',
        name: 'Custom (OpenAI-compatible)',
        requiresApiKey: false,
        requiresBaseUrl: true,
        getModels: vi.fn(),
      },
    ]);

    render(AiTab, { mode: 'providers-only' });

    expect(screen.getByText('Local Ollama')).toBeTruthy();
    expect(screen.getByText('Custom (OpenAI-compatible)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Local Ollama' })).toBeTruthy();
  });
});
