// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: { currentAgentId: null },
}));
vi.mock('../../components', async () => ({
  Textarea: (await import('../../components/base/Textarea.svelte')).default,
  ModelSelector: (await import('../../components/form/ModelSelector.svelte')).default,
}));
vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { goBack: vi.fn() },
}));
vi.mock('../../services/ai/providerRegistry', () => ({
  providerRegistry: { list: vi.fn().mockReturnValue([]) },
}));
vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi
      .fn()
      .mockReturnValue({ ai: { providers: {}, defaultAgentId: 'default-agent-1' } }),
  },
}));
vi.mock('../../lib/ipc/commands', () => ({
  agentsEditorLoad: vi.fn(),
  agentsEditorListModels: vi.fn(),
  agentsEditorSave: vi.fn(),
}));

import AgentEditView from './AgentEditView.svelte';
import { agentsEditorLoad, agentsEditorListModels, agentsEditorSave } from '../../lib/ipc/commands';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

const form = {
  name: 'Rust Agent',
  description: '',
  systemPrompt: 'Be useful.',
  providerId: '',
  modelId: '',
  toolSelection: [],
  silent: false,
  inputSource: 'argument' as const,
  outputAction: 'replaceSelection' as const,
};

describe('AgentEditView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentsEditorLoad).mockResolvedValue({
      form: { ...form },
      providers: [],
      toolGroups: [],
    });
    vi.mocked(agentsEditorSave).mockResolvedValue({ id: 'agent-1' } as never);
  });

  it('renders the Rust view-model and submits the bound form back to Rust', async () => {
    render(AgentEditView);
    const name = await screen.findByDisplayValue('Rust Agent');
    await fireEvent.input(name, { target: { value: 'Updated Agent' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(agentsEditorSave).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ name: 'Updated Agent', systemPrompt: 'Be useful.' }),
      ),
    );
    expect(viewManager.goBack).toHaveBeenCalled();
  });

  it('passes the settings default agent id so Rust can pre-fill a new agent', async () => {
    render(AgentEditView);
    await screen.findByDisplayValue('Rust Agent');

    expect(agentsEditorLoad).toHaveBeenCalledWith(null, 'default-agent-1', [], {});
  });

  it('renders an authoritative Rust validation error without navigating', async () => {
    vi.mocked(agentsEditorSave).mockRejectedValue(new Error('name must not be empty'));
    render(AgentEditView);
    await screen.findByDisplayValue('Rust Agent');

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('name must not be empty')).toBeTruthy();
    expect(viewManager.goBack).not.toHaveBeenCalled();
  });

  it('allows picking a model using ModelSelector', async () => {
    vi.mocked(agentsEditorLoad).mockResolvedValue({
      form: { ...form, providerId: 'anthropic', modelId: 'claude-3-7-sonnet' },
      providers: [{ id: 'anthropic', name: 'Anthropic' }],
      toolGroups: [],
    });
    vi.mocked(settingsService.getSettings).mockReturnValue({
      ai: {
        providers: {
          anthropic: { enabled: true, apiKey: 'sk-ant' },
        },
        defaultAgentId: 'default-agent-1',
      },
    } as any);
    vi.mocked(agentsEditorListModels).mockResolvedValue({
      models: [
        { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
      ],
      selectedModelId: 'claude-3-7-sonnet',
    });

    render(AgentEditView);

    const trigger = await screen.findByText('Claude 3.7 Sonnet');
    await fireEvent.click(trigger);

    const searchInput = screen.getByRole('textbox', { name: /Filter models/i });
    await fireEvent.input(searchInput, { target: { value: 'haiku' } });

    const haikuOption = screen.getByText('Claude 3.5 Haiku');
    await fireEvent.click(haikuOption);

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(agentsEditorSave).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ modelId: 'claude-3-5-haiku' }),
      ),
    );
  });
});
