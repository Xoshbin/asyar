// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentService.svelte', () => ({
  agentService: { getById: vi.fn() },
}));
vi.mock('./threadProvider', () => ({
  setActiveThreadModel: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../services/ai/providerRegistry', () => ({
  providerRegistry: {
    list: () => [
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai', name: 'OpenAI' },
      { id: 'google', name: 'Google Gemini' },
    ],
  },
}));
vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: {
        providers: {
          anthropic: { enabled: true, lastModelId: 'sonnet' },
          openai: { enabled: true, lastModelId: 'gpt-4o' },
          // No saved model: switching to it has to ask which model.
          google: { enabled: true },
        },
      },
    },
  },
}));
vi.mock('../../lib/ipc/commands', () => ({
  aiListModels: vi.fn(async (providerId: string) =>
    providerId === 'anthropic'
      ? [
          { id: 'opus', label: 'Claude Opus' },
          { id: 'sonnet', label: 'Claude Sonnet' },
        ]
      : [{ id: 'gemini-pro', label: 'Gemini Pro' }],
  ),
}));

// jsdom has no top-layer engine, so <dialog>.showModal()/close() (used by
// Modal.svelte) are missing.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

import ModelPickerModal from './ModelPickerModal.svelte';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { setActiveThreadModel } from './threadProvider';
import { modelCatalog } from './modelCatalog.svelte';

function labels() {
  return screen.getAllByRole('option').map((row) => row.textContent?.trim());
}

describe('ModelPickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(agentService.getById).mockReturnValue({
      id: 'agent-1',
      providerId: 'anthropic',
      modelId: 'sonnet',
    } as any);
    agentsManager.currentAgentId = 'agent-1';
    agentsManager.currentThreadId = null;
    agentsManager.picker = null;
    modelCatalog.models = {};
    modelCatalog.errors = {};
  });

  describe('Change Provider', () => {
    beforeEach(() => {
      agentsManager.picker = 'provider';
    });

    it('lists the providers the user has set up, the one in use checked', async () => {
      render(ModelPickerModal);
      await screen.findByText('Change Provider');

      expect(labels()).toEqual(['Anthropic', 'OpenAI', 'Google Gemini']);
      expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    });

    it("switches the thread to the provider's last-used model", async () => {
      render(ModelPickerModal);
      await fireEvent.click(await screen.findByText('OpenAI'));

      expect(setActiveThreadModel).toHaveBeenCalledWith({
        providerId: 'openai',
        modelId: 'gpt-4o',
      });
      expect(agentsManager.picker).toBeNull();
    });

    it('asks for a model when the provider has none saved yet', async () => {
      render(ModelPickerModal);
      await fireEvent.click(await screen.findByText('Google Gemini'));

      expect(setActiveThreadModel).not.toHaveBeenCalled();
      expect(agentsManager.picker).toBe('model');
      await screen.findByText('Change Model · Google Gemini');
      await fireEvent.click(await screen.findByText('Gemini Pro'));

      expect(setActiveThreadModel).toHaveBeenCalledWith({
        providerId: 'google',
        modelId: 'gemini-pro',
      });
      expect(agentsManager.picker).toBeNull();
    });
  });

  describe('Change Model', () => {
    beforeEach(() => {
      agentsManager.picker = 'model';
    });

    it("lists only the current provider's models, the one in use checked", async () => {
      render(ModelPickerModal);
      await screen.findByText('Change Model · Anthropic');
      await screen.findByText('Claude Opus');

      expect(labels()).toEqual(['Claude Opus', 'Claude Sonnet']);
      expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
      expect(screen.queryByText('Gemini Pro')).toBeNull();
    });

    it('filters as you type and picks the top match with Enter', async () => {
      render(ModelPickerModal);
      await screen.findByText('Claude Opus');
      const input = screen.getByPlaceholderText('Search models…');

      await fireEvent.input(input, { target: { value: 'son' } });
      await waitFor(() => expect(labels()).toEqual(['Claude Sonnet']));
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(setActiveThreadModel).toHaveBeenCalledWith({
        providerId: 'anthropic',
        modelId: 'sonnet',
      });
      expect(agentsManager.picker).toBeNull();
    });

    it('moves the highlight with the arrow keys', async () => {
      render(ModelPickerModal);
      await screen.findByText('Claude Opus');
      const input = screen.getByPlaceholderText('Search models…');

      // The list opens on the model in use (Sonnet); wrap around to Opus.
      await fireEvent.keyDown(input, { key: 'ArrowDown' });
      await fireEvent.keyDown(input, { key: 'Enter' });

      expect(setActiveThreadModel).toHaveBeenCalledWith({
        providerId: 'anthropic',
        modelId: 'opus',
      });
    });
  });
});
