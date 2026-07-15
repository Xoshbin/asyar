// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: { currentAgentId: null },
}));
vi.mock('../../components', async () => ({
  Textarea: (await import('../../components/base/Textarea.svelte')).default,
}));
vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { goBack: vi.fn() },
}));
vi.mock('../../services/ai/providerRegistry', () => ({
  providerRegistry: { list: vi.fn().mockReturnValue([]) },
}));
vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({ ai: { providers: {} } }),
  },
}));
vi.mock('../../lib/ipc/commands', () => ({
  agentsEditorLoad: vi.fn(),
  agentsEditorListModels: vi.fn(),
  agentsEditorSave: vi.fn(),
}));

import AgentEditView from './AgentEditView.svelte';
import { agentsEditorLoad, agentsEditorSave } from '../../lib/ipc/commands';
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

  it('renders an authoritative Rust validation error without navigating', async () => {
    vi.mocked(agentsEditorSave).mockRejectedValue(new Error('name must not be empty'));
    render(AgentEditView);
    await screen.findByDisplayValue('Rust Agent');

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('name must not be empty')).toBeTruthy();
    expect(viewManager.goBack).not.toHaveBeenCalled();
  });
});
