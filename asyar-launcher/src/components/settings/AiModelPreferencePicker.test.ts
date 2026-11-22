// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mockListModels = vi.fn();

vi.mock('../../services/ai/aiService', () => ({
  aiService: {
    listModels: () => mockListModels(),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import AiModelPreferencePicker from './AiModelPreferencePicker.svelte';

describe('AiModelPreferencePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists configured models and safely round-trips colon-containing providerId and modelId', async () => {
    mockListModels.mockResolvedValueOnce([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-4o',
        label: 'GPT-4o',
        isDefault: true,
      },
      {
        providerId: 'ext:org.acme.local:ollama',
        providerName: 'Local Ollama',
        modelId: 'llama3.2:latest',
        label: 'Llama 3.2 (latest)',
      },
    ]);

    const onchange = vi.fn();
    render(AiModelPreferencePicker, {
      props: {
        value: undefined,
        required: false,
        onchange,
      },
    });

    const trigger = screen.getByRole('combobox');
    await vi.waitFor(() => {
      expect(trigger.textContent).toContain('Use Asyar default');
    });

    await fireEvent.click(trigger);

    const ollamaOption = await screen.findByRole('option', {
      name: /Local Ollama — Llama 3\.2 \(latest\)/,
    });
    await fireEvent.click(ollamaOption);

    expect(onchange).toHaveBeenCalledWith({
      providerId: 'ext:org.acme.local:ollama',
      modelId: 'llama3.2:latest',
    });
  });

  it('allows clearing back to undefined via Use Asyar default when optional', async () => {
    mockListModels.mockResolvedValueOnce([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-4o',
        label: 'GPT-4o',
      },
    ]);

    const onchange = vi.fn();
    render(AiModelPreferencePicker, {
      props: {
        value: { providerId: 'openai', modelId: 'gpt-4o' },
        required: false,
        onchange,
      },
    });

    const trigger = screen.getByRole('combobox');
    await vi.waitFor(() => {
      expect(trigger.textContent).toContain('OpenAI — GPT-4o');
    });

    await fireEvent.click(trigger);
    const defaultOption = await screen.findByRole('option', { name: /Use Asyar default/ });
    await fireEvent.click(defaultOption);

    expect(onchange).toHaveBeenCalledWith(undefined);
  });

  it('omits Use Asyar default when required', async () => {
    mockListModels.mockResolvedValueOnce([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-4o',
        label: 'GPT-4o',
      },
    ]);

    render(AiModelPreferencePicker, {
      props: {
        value: undefined,
        required: true,
        onchange: vi.fn(),
      },
    });

    const trigger = screen.getByRole('combobox');
    await vi.waitFor(() => {
      expect(trigger.textContent).toContain('Select an AI model');
    });

    await fireEvent.click(trigger);
    expect(screen.queryByRole('option', { name: /Use Asyar default/ })).toBeNull();
    expect(screen.getByRole('option', { name: /OpenAI — GPT-4o/ })).toBeTruthy();
  });

  it('preserves a stale or offline saved model as an unavailable option', async () => {
    mockListModels.mockResolvedValueOnce([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-4o',
        label: 'GPT-4o',
      },
    ]);

    render(AiModelPreferencePicker, {
      props: {
        value: { providerId: 'ollama', modelId: 'qwen2.5:7b' },
        required: false,
        onchange: vi.fn(),
      },
    });

    const trigger = screen.getByRole('combobox');
    await vi.waitFor(() => {
      expect(trigger.textContent).toContain('ollama — qwen2.5:7b (unavailable)');
    });
  });

  it('shows a hint when no models are configured', async () => {
    mockListModels.mockResolvedValueOnce([]);

    render(AiModelPreferencePicker, {
      props: {
        value: undefined,
        required: false,
        onchange: vi.fn(),
      },
    });

    expect(await screen.findByText(/No AI models configured/i)).toBeTruthy();
  });

  it('shows an alert when loading models fails', async () => {
    mockListModels.mockRejectedValueOnce(new Error('IPC error'));

    render(AiModelPreferencePicker, {
      props: {
        value: undefined,
        required: false,
        onchange: vi.fn(),
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load AI models');
  });

  it('reflects external value updates and keeps required picker enabled after empty load', async () => {
    mockListModels.mockResolvedValue([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-4o',
        label: 'GPT-4o',
        isDefault: true,
      },
      {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        isDefault: false,
      },
    ]);

    const { rerender, unmount } = render(AiModelPreferencePicker, {
      props: {
        value: { providerId: 'openai', modelId: 'gpt-4o' },
        required: false,
        onchange: vi.fn(),
      },
    });

    const trigger = screen.getByRole('combobox');
    await vi.waitFor(() => {
      expect(trigger.textContent).toContain('OpenAI — GPT-4o');
    });

    await rerender({
      value: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      required: false,
      onchange: vi.fn(),
    });
    expect(trigger.textContent).toContain('Anthropic — Claude Sonnet 4.6');
    unmount();

    mockListModels.mockResolvedValueOnce([]);
    render(AiModelPreferencePicker, {
      props: {
        value: undefined,
        required: true,
        onchange: vi.fn(),
      },
    });

    const requiredTrigger = screen.getByRole('combobox') as HTMLButtonElement;
    await vi.waitFor(() => {
      expect(requiredTrigger.disabled).toBe(false);
    });
  });
});
