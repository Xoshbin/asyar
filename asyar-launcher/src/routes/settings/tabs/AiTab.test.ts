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
  SettingsRow: (await import('../../../components/settings/SettingsRow.svelte')).default,
  Toggle: (await import('../../../components/base/Toggle.svelte')).default,
  ModelSelector: (await import('../../../components/form/ModelSelector.svelte')).default,
  Select: (await import('../../../components/base/Select.svelte')).default,
  CredentialField: (await import('../../../components/settings/CredentialField.svelte')).default,
}));
vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        providers: {
          anthropic: { enabled: true, lastModelId: 'claude-sonnet-5' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
        historyRetentionCap: 100,
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
        supportsCliMode: true,
        cliName: 'claude',
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
  aiCheckCliStatus: vi.fn(),
  aiGetCredentialStatus: vi.fn().mockResolvedValue({ providers: {}, webSearch: {} }),
  aiSaveCredential: vi.fn().mockResolvedValue(undefined),
  aiDeleteCredential: vi.fn().mockResolvedValue(true),
}));

import AiTab from './AiTab.svelte';
import {
  agentsProviderRemovalBlockers,
  aiGetCredentialStatus,
  aiSaveCredential,
  aiDeleteCredential,
} from '../../../lib/ipc/commands';
import { settingsService } from '../../../services/settings/settingsService.svelte';
import { providerRegistry } from '../../../services/ai/providerRegistry';

describe('AiTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService).currentSettings = {
      ai: {
        providers: {
          anthropic: { enabled: true, lastModelId: 'claude-sonnet-5' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
        historyRetentionCap: 100,
      },
    } as any;
    vi.mocked(providerRegistry.list).mockReturnValue([
      {
        id: 'anthropic',
        name: 'Anthropic',
        requiresApiKey: true,
        requiresBaseUrl: false,
        supportsCliMode: true,
        cliName: 'claude',
        getModels: vi.fn(),
      },
    ]);
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

  it('renders model default for temperature when undefined and allows setting custom value', async () => {
    vi.mocked(settingsService).currentSettings = {
      ai: {
        providers: {
          anthropic: { enabled: true, lastModelId: 'claude-sonnet-5' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },
    } as any;
    vi.mocked(providerRegistry.list).mockReturnValue([
      {
        id: 'anthropic',
        name: 'Anthropic',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: vi.fn(),
      },
    ]);

    render(AiTab, { mode: 'providers-only' });

    // Expand the Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    expect(screen.getByText(/Temperature:\s*Model default/)).toBeTruthy();
    expect(screen.getByText('(omitted)')).toBeTruthy();

    const rangeInput = screen.getByLabelText(/Temperature:/) as HTMLInputElement;
    await fireEvent.input(rangeInput, { target: { value: '0.85' } });

    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      providers: {
        anthropic: expect.objectContaining({
          temperature: 0.85,
        }),
      },
    });
  });

  it('renders custom temperature and allows resetting to model default', async () => {
    vi.mocked(settingsService).currentSettings = {
      ai: {
        providers: {
          anthropic: {
            enabled: true,
            apiKey: 'sk-ant',
            lastModelId: 'claude-sonnet-5',
            temperature: 0.85,
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
        id: 'anthropic',
        name: 'Anthropic',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: vi.fn(),
      },
    ]);

    render(AiTab, { mode: 'providers-only' });

    // Expand the Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    expect(screen.getByText(/Temperature:\s*0\.85/)).toBeTruthy();
    const resetBtn = screen.getByRole('button', { name: 'Use model default' });
    expect(resetBtn).toBeTruthy();

    await fireEvent.click(resetBtn);

    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      providers: {
        anthropic: expect.objectContaining({
          temperature: undefined,
        }),
      },
    });
  });

  it('allows searching and selecting a model via ModelSelector', async () => {
    const getModelsMock = vi.fn().mockResolvedValue([
      { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
      { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus', label: 'Claude 3 Opus' },
    ]);

    vi.mocked(settingsService).currentSettings = {
      ai: {
        providers: {
          anthropic: { enabled: true, apiKey: 'sk-ant' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },
    } as any;
    vi.mocked(providerRegistry.list).mockReturnValue([
      {
        id: 'anthropic',
        name: 'Anthropic',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: getModelsMock,
      },
    ]);

    render(AiTab, { mode: 'providers-only' });

    // Expand Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    // Fetch models
    const fetchBtn = screen.getByRole('button', { name: 'Test & Fetch Models' });
    await fireEvent.click(fetchBtn);

    // Open model selector
    const trigger = await screen.findByText('Claude 3.7 Sonnet');
    await fireEvent.click(trigger);

    // Filter models
    const searchInput = screen.getByRole('textbox', { name: /Filter models/i });
    await fireEvent.input(searchInput, { target: { value: 'haiku' } });

    // Select filtered model
    const haikuOption = screen.getByText('Claude 3.5 Haiku');
    await fireEvent.click(haikuOption);

    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      providers: {
        anthropic: expect.objectContaining({
          lastModelId: 'claude-3-5-haiku',
        }),
      },
    });
  });

  it('renders ModelSelector with saved lastModelId even before manual fetch', async () => {
    vi.mocked(settingsService).currentSettings = {
      ai: {
        providers: {
          anthropic: { enabled: true, lastModelId: 'claude-sonnet-5' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
      },
    } as any;
    vi.mocked(providerRegistry.list).mockReturnValue([
      {
        id: 'anthropic',
        name: 'Anthropic',
        requiresApiKey: true,
        requiresBaseUrl: false,
        getModels: vi.fn(),
      },
    ]);

    render(AiTab, { mode: 'providers-only' });

    // Expand Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    // Model selector is immediately visible with the saved lastModelId
    expect(screen.getByText(/claude-sonnet-5/)).toBeTruthy();
  });

  it('renders web search card and allows changing engine', async () => {
    settingsService.currentSettings = {
      ai: {
        providers: {
          anthropic: { enabled: true, lastModelId: 'claude-sonnet-5' },
        },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
        webSearch: {
          engine: 'duckduckgo',
        },
      },
    } as any;

    render(AiTab, { mode: 'full' });

    expect(screen.getByText('Web Search')).toBeTruthy();
    const select = screen.getByLabelText('Search engine') as HTMLSelectElement;
    expect(select.value).toBe('duckduckgo');

    // Switch to Brave Search
    await fireEvent.change(select, { target: { value: 'brave' } });
    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      webSearch: {
        engine: 'brave',
      },
    });
  });

  it('saves provider key, clears input, and shows "Key saved"', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({
      providers: {},
      webSearch: {},
    });

    render(AiTab, { mode: 'providers-only' });

    // Expand Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    const input = screen.getByPlaceholderText('sk-••••••••••••••••') as HTMLInputElement;
    expect(input).toBeTruthy();

    await fireEvent.input(input, { target: { value: 'sk-ant-test12345' } });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await fireEvent.click(saveButton);

    expect(aiSaveCredential).toHaveBeenCalledWith(
      { type: 'provider', id: 'anthropic' },
      'sk-ant-test12345',
    );
    expect(await screen.findByText('Key saved')).toBeTruthy();
  });

  it('supports Replace and Remove actions on configured key', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({
      providers: { anthropic: 'configured' },
      webSearch: {},
    });

    render(AiTab, { mode: 'providers-only' });

    // Expand Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    expect(screen.getByText('Key saved')).toBeTruthy();
    const replaceBtn = screen.getByRole('button', { name: 'Replace' });
    const removeBtn = screen.getByRole('button', { name: 'Remove' });

    // Click Replace reveals input and Cancel
    await fireEvent.click(replaceBtn);
    expect(screen.getByPlaceholderText('sk-••••••••••••••••')).toBeTruthy();
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await fireEvent.click(cancelBtn);
    expect(screen.getByText('Key saved')).toBeTruthy();

    // Click Remove deletes key
    const newRemoveBtn = screen.getByRole('button', { name: 'Remove' });
    await fireEvent.click(newRemoveBtn);
    expect(aiDeleteCredential).toHaveBeenCalledWith({
      type: 'provider',
      id: 'anthropic',
    });
    expect(await screen.findByPlaceholderText('sk-••••••••••••••••')).toBeTruthy();
  });

  it('displays warning when key needs reentry', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({
      providers: { anthropic: 'needsReentry' },
      webSearch: {},
    });

    render(AiTab, { mode: 'providers-only' });

    // Expand Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    expect(screen.getByText("This key can't be read anymore. Please enter it again.")).toBeTruthy();
    expect(screen.getByPlaceholderText('sk-••••••••••••••••')).toBeTruthy();
  });

  it('deleting a custom provider calls aiDeleteCredential with its id', async () => {
    vi.mocked(agentsProviderRemovalBlockers).mockResolvedValue(null);
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

    render(AiTab, { mode: 'providers-only' });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Local Ollama' }));

    expect(aiDeleteCredential).toHaveBeenCalledWith({
      type: 'provider',
      id: 'custom_1',
    });
  });

  it('switching to CLI mode does not delete the stored API key', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({
      providers: { anthropic: 'configured' },
      webSearch: {},
    });

    render(AiTab, { mode: 'providers-only' });

    // Expand Anthropic row
    await fireEvent.click(screen.getByText('Anthropic'));

    const modeSelect = screen.getByLabelText('Connection method') as HTMLSelectElement;
    expect(modeSelect.value).toBe('api_key');

    await fireEvent.change(modeSelect, { target: { value: 'cli' } });

    expect(aiDeleteCredential).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      providers: {
        anthropic: expect.objectContaining({
          connectionMode: 'cli',
        }),
      },
    });
  });

  function webSearchSettings(engine: string) {
    settingsService.currentSettings = {
      ai: {
        providers: { anthropic: { enabled: true, lastModelId: 'claude-sonnet-5' } },
        maxTokens: 1024,
        temperature: 0.7,
        defaultAgentId: null,
        tabContinuesLastThread: false,
        webSearch: { engine },
      },
    } as any;
  }

  it('saves a web search key for the selected engine', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({ providers: {}, webSearch: {} });
    webSearchSettings('brave');

    render(AiTab, { mode: 'full' });

    const keyInput = (await screen.findByPlaceholderText('BSA...')) as HTMLInputElement;
    await fireEvent.input(keyInput, { target: { value: 'BSA-testkey' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(aiSaveCredential).toHaveBeenCalledWith(
      { type: 'webSearch', engine: 'brave' },
      'BSA-testkey',
    );
    expect(await screen.findByText('Key saved')).toBeTruthy();
  });

  it('changing the search engine never deletes a stored key', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({
      providers: {},
      webSearch: { brave: 'configured', tavily: 'notConfigured', serply: 'notConfigured' },
    });
    webSearchSettings('brave');

    render(AiTab, { mode: 'full' });
    expect(await screen.findByText('Key saved')).toBeTruthy();

    const select = screen.getByLabelText('Search engine') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'tavily' } });

    expect(aiDeleteCredential).not.toHaveBeenCalled();
    expect(settingsService.updateSettings).toHaveBeenCalledWith('ai', {
      webSearch: { engine: 'tavily' },
    });
  });

  it('each keyed engine shows only its own key state', async () => {
    vi.mocked(aiGetCredentialStatus).mockResolvedValue({
      providers: {},
      webSearch: { brave: 'configured', tavily: 'notConfigured', serply: 'needsReentry' },
    });

    webSearchSettings('brave');
    const brave = render(AiTab, { mode: 'full' });
    expect(await screen.findByText('Key saved')).toBeTruthy();
    brave.unmount();

    webSearchSettings('tavily');
    const tavily = render(AiTab, { mode: 'full' });
    expect(await screen.findByPlaceholderText('tvly-...')).toBeTruthy();
    expect(screen.queryByText('Key saved')).toBeNull();
    tavily.unmount();

    webSearchSettings('serply');
    render(AiTab, { mode: 'full' });
    expect(
      await screen.findByText("This key can't be read anymore. Please enter it again."),
    ).toBeTruthy();
    expect(screen.queryByText('Key saved')).toBeNull();
  });

  it('does not render key fields until the credential status has loaded', async () => {
    let resolveStatus!: (v: {
      providers: Record<string, never>;
      webSearch: Record<string, never>;
    }) => void;
    vi.mocked(aiGetCredentialStatus).mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve as typeof resolveStatus;
      }),
    );

    render(AiTab, { mode: 'providers-only' });
    await fireEvent.click(screen.getByText('Anthropic'));
    expect(screen.queryByPlaceholderText('sk-••••••••••••••••')).toBeNull();

    resolveStatus({ providers: {}, webSearch: {} });
    expect(await screen.findByPlaceholderText('sk-••••••••••••••••')).toBeTruthy();
  });

  it('shows key fields as not configured when the credential status fails to load', async () => {
    vi.mocked(aiGetCredentialStatus).mockRejectedValue(new Error('boom'));

    render(AiTab, { mode: 'providers-only' });
    await fireEvent.click(screen.getByText('Anthropic'));

    expect(await screen.findByPlaceholderText('sk-••••••••••••••••')).toBeTruthy();
  });

  it('keeps a provider and shows why when its saved key cannot be deleted', async () => {
    vi.mocked(agentsProviderRemovalBlockers).mockResolvedValue(null);
    vi.mocked(aiDeleteCredential).mockRejectedValueOnce(new Error('db locked'));

    render(AiTab, { mode: 'providers-only' });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Anthropic' }));

    expect(
      await screen.findByText("Couldn't remove this provider's saved key. Please try again."),
    ).toBeTruthy();
    expect(settingsService.updateSettings).not.toHaveBeenCalled();
  });

  it('renders history retention cap and handles option change', async () => {
    const handler = {
      handleHistoryRetentionCapChange: vi.fn(),
    } as any;

    render(AiTab, { mode: 'full', handler });

    expect(screen.getByText('History retention cap')).toBeTruthy();

    const select = screen.getAllByRole('combobox').find((el) => {
      const options = Array.from((el as HTMLSelectElement).options).map((o) => o.value);
      return options.includes('100') && options.includes('custom');
    }) as HTMLSelectElement;

    expect(select).toBeTruthy();
    expect(select.value).toBe('100');

    await fireEvent.change(select, { target: { value: '50' } });
    expect(handler.handleHistoryRetentionCapChange).toHaveBeenCalledWith(50);
  });
});
