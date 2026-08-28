// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from './ModelSelector.svelte';
import type { ModelInfo } from '../../services/ai/IProviderPlugin';

const sampleModels: ModelInfo[] = [
  { id: 'anthropic/claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
  { id: 'anthropic/claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/gpt-5-preview', label: 'GPT-5 Preview' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
];

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders selected model label on the trigger button', () => {
    render(ModelSelector, {
      models: sampleModels,
      value: 'openai/gpt-4o',
    });

    expect(screen.getByRole('button', { name: /GPT-4o/ })).toBeTruthy();
  });

  it('renders placeholder when value is empty', () => {
    render(ModelSelector, {
      models: sampleModels,
      value: '',
      placeholder: 'Choose AI model…',
    });

    expect(screen.getByRole('button', { name: /Choose AI model…/ })).toBeTruthy();
  });

  it('renders custom badge when value is not in models list', () => {
    render(ModelSelector, {
      models: sampleModels,
      value: 'my-custom-model-id',
    });

    expect(screen.getByRole('button', { name: /my-custom-model-id.*custom/ })).toBeTruthy();
  });

  it('opens popover and focuses search input when clicked', async () => {
    render(ModelSelector, {
      models: sampleModels,
      value: 'openai/gpt-4o',
    });

    const trigger = screen.getByRole('button', { name: /GPT-4o/ });
    await fireEvent.click(trigger);

    const searchInput = screen.getByRole('textbox', { name: /Filter models/i });
    expect(searchInput).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBe(sampleModels.length);
  });

  it('filters models by display label', async () => {
    render(ModelSelector, {
      models: sampleModels,
      value: '',
    });

    const trigger = screen.getByRole('button');
    await fireEvent.click(trigger);

    const searchInput = screen.getByRole('textbox', { name: /Filter models/i });
    await fireEvent.input(searchInput, { target: { value: 'claude' } });

    const options = screen.getAllByRole('option');
    // 2 claude models matching + custom option for 'claude'
    expect(screen.getByText('Claude 3.7 Sonnet')).toBeTruthy();
    expect(screen.getByText('Claude 3.5 Haiku')).toBeTruthy();
    expect(screen.queryByText('GPT-4o')).toBeNull();
  });

  it('filters models by model ID', async () => {
    render(ModelSelector, {
      models: sampleModels,
      value: '',
    });

    const trigger = screen.getByRole('button');
    await fireEvent.click(trigger);

    const searchInput = screen.getByRole('textbox', { name: /Filter models/i });
    await fireEvent.input(searchInput, { target: { value: 'gpt-5' } });

    expect(screen.getByText('GPT-5 Preview')).toBeTruthy();
    expect(screen.getByText('openai/gpt-5-preview')).toBeTruthy();
    expect(screen.queryByText('Claude 3.7 Sonnet')).toBeNull();
  });

  it('selects a model when clicked and calls onchange callback', async () => {
    const onchange = vi.fn();
    render(ModelSelector, {
      models: sampleModels,
      value: 'openai/gpt-4o',
      onchange,
    });

    await fireEvent.click(screen.getByRole('button', { name: /GPT-4o/ }));

    const haikuOption = screen.getByText('Claude 3.5 Haiku');
    await fireEvent.click(haikuOption);

    expect(onchange).toHaveBeenCalledWith('anthropic/claude-3-5-haiku');
  });

  it('allows selecting a custom model ID when typed query is not in catalog', async () => {
    const onchange = vi.fn();
    render(ModelSelector, {
      models: sampleModels,
      value: '',
      allowCustom: true,
      onchange,
    });

    await fireEvent.click(screen.getByRole('button'));

    const searchInput = screen.getByRole('textbox', { name: /Filter models/i });
    await fireEvent.input(searchInput, { target: { value: 'deepseek/deepseek-r1' } });

    const customAction = screen.getByText(/Use custom model "deepseek\/deepseek-r1"/i);
    expect(customAction).toBeTruthy();

    await fireEvent.click(customAction);
    expect(onchange).toHaveBeenCalledWith('deepseek/deepseek-r1');
  });

  it('supports keyboard navigation with ArrowDown, ArrowUp, and Enter', async () => {
    const onchange = vi.fn();
    render(ModelSelector, {
      models: sampleModels,
      value: 'anthropic/claude-3-7-sonnet',
      onchange,
    });

    const trigger = screen.getByRole('button', { name: /Claude 3.7 Sonnet/ });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const popover = screen.getByRole('region', { name: /Model selector popover/i });
    expect(popover).toBeTruthy();

    // Navigate to next option (Claude 3.5 Haiku)
    await fireEvent.keyDown(popover, { key: 'ArrowDown' });
    await fireEvent.keyDown(popover, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledWith('anthropic/claude-3-5-haiku');
  });

  it('closes popover on Escape', async () => {
    render(ModelSelector, {
      models: sampleModels,
      value: 'openai/gpt-4o',
    });

    await fireEvent.click(screen.getByRole('button', { name: /GPT-4o/ }));
    expect(screen.getByRole('region', { name: /Model selector popover/i })).toBeTruthy();

    const popover = screen.getByRole('region', { name: /Model selector popover/i });
    await fireEvent.keyDown(popover, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: /Model selector popover/i })).toBeNull();
  });
});
