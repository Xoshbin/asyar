// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ActionListPopup from './ActionListPopup.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { invokeAction } from '../../services/action/invokeAction';

vi.mock('../../services/log/logService', () => ({ logService: { debug: vi.fn() } }));
vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../services/action/invokeAction', () => ({
  invokeAction: vi.fn(async (action) => {
    await action.execute();
  }),
}));

const action = (id: string, label: string, execute: () => void | Promise<void> = vi.fn()) => ({
  id,
  label,
  displayCategory: 'Default',
  execute,
});

describe('ActionListPopup navigation stack', () => {
  beforeEach(() => {
    actionService.activePrompt = null;
    actionService.panelSearchQuery = '';
    vi.clearAllMocks();
  });

  it('drills into children and runs the picked child directly', async () => {
    const runZed = vi.fn();
    const openWith = {
      ...action('open-with', 'Open With'),
      children: () => [{ id: 'open-with:zed', label: 'Zed', execute: runZed }],
    };
    const { getByText, queryByText } = render(ActionListPopup, {
      props: { availableActions: [action('copy', 'Copy'), openWith] },
    });

    await fireEvent.click(getByText('Open With'));
    await tick();
    expect(queryByText('Copy')).toBeNull();

    await fireEvent.click(getByText('Zed'));
    expect(invokeAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'open-with:zed' }), {
      direct: true,
    });
    expect(runZed).toHaveBeenCalled();
  });

  it('escapes through action search clearing before closing', async () => {
    const onclose = vi.fn();
    const { getByPlaceholderText } = render(ActionListPopup, {
      props: {
        availableActions: [action('copy', 'Copy'), action('rename', 'Rename')],
        onclose,
      },
    });

    const searchInput = getByPlaceholderText(
      'dialogs.action_list.search_placeholder',
    ) as HTMLInputElement;
    await fireEvent.input(searchInput, { target: { value: 'ren' } });
    expect(searchInput.value).toBe('ren');

    // First Esc clears search query
    await fireEvent.keyDown(searchInput, { key: 'Escape' });
    expect(searchInput.value).toBe('');
    expect(onclose).not.toHaveBeenCalled();

    // Second Esc closes popup
    await fireEvent.keyDown(searchInput, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('navigates into prompt view, unwinds Escape stack step-by-step preserving action search query', async () => {
    const onclose = vi.fn();
    const oncancel = vi.fn();
    const onsave = vi.fn();

    const renameAction = action('rename', 'Rename Entry', () => {
      actionService.openPrompt({
        title: 'Rename Entry...',
        value: 'My Old Item',
        placeholder: 'Enter new title...',
        contextLabel: 'Clipboard History',
        onsave,
        oncancel,
      });
    });

    const { getByPlaceholderText, queryByPlaceholderText } = render(ActionListPopup, {
      props: {
        availableActions: [action('copy', 'Copy'), renameAction],
        onclose,
      },
    });

    const searchInput = getByPlaceholderText(
      'dialogs.action_list.search_placeholder',
    ) as HTMLInputElement;
    await fireEvent.input(searchInput, { target: { value: 'ren' } });
    expect(searchInput.value).toBe('ren');

    // Press Enter to select the rename action
    await fireEvent.keyDown(searchInput, { key: 'Enter' });
    await tick();

    // Now prompt view is active!
    const promptInput = getByPlaceholderText('Enter new title...') as HTMLInputElement;
    expect(promptInput).toBeTruthy();
    expect(promptInput.value).toBe('My Old Item');

    // Type something in prompt
    await fireEvent.input(promptInput, { target: { value: 'Edited Title' } });
    expect(promptInput.value).toBe('Edited Title');

    // Step 1: Escape with text in prompt clears prompt input
    await fireEvent.keyDown(promptInput, { key: 'Escape' });
    expect(promptInput.value).toBe('');
    expect(oncancel).not.toHaveBeenCalled();
    expect(queryByPlaceholderText('Enter new title...')).toBeTruthy();

    // Step 2: Escape with empty prompt cancels prompt and returns to action list
    await fireEvent.keyDown(promptInput, { key: 'Escape' });
    await tick();
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(queryByPlaceholderText('Enter new title...')).toBeNull();

    // The action search input is back and its search query "ren" is STILL INTACT!
    const restoredSearchInput = getByPlaceholderText(
      'dialogs.action_list.search_placeholder',
    ) as HTMLInputElement;
    expect(restoredSearchInput).toBeTruthy();
    expect(restoredSearchInput.value).toBe('ren');
    expect(onclose).not.toHaveBeenCalled();

    // Step 3: Escape clears action search input "ren" -> ""
    await fireEvent.keyDown(restoredSearchInput, { key: 'Escape' });
    expect(restoredSearchInput.value).toBe('');
    expect(onclose).not.toHaveBeenCalled();

    // Step 4: Escape closes ActionListPopup
    await fireEvent.keyDown(restoredSearchInput, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('handles direct prompt opening without action list stack', async () => {
    const onclose = vi.fn();
    const oncancel = vi.fn();
    const onsave = vi.fn();

    actionService.activePrompt = {
      title: 'Rename Directly',
      value: 'Direct Value',
      placeholder: 'Type direct...',
      onsave,
      oncancel,
    };

    const { getByPlaceholderText } = render(ActionListPopup, {
      props: {
        availableActions: [],
        onclose,
      },
    });

    const promptInput = getByPlaceholderText('Type direct...') as HTMLInputElement;
    expect(promptInput.value).toBe('Direct Value');

    // Esc with text clears input
    await fireEvent.keyDown(promptInput, { key: 'Escape' });
    expect(promptInput.value).toBe('');
    expect(oncancel).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();

    // Esc with empty input cancels and closes popup immediately
    await fireEvent.keyDown(promptInput, { key: 'Escape' });
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('saves and closes on Enter in prompt view', async () => {
    const onclose = vi.fn();
    const onsave = vi.fn();

    actionService.activePrompt = {
      title: 'Rename Directly',
      value: 'Direct Value',
      placeholder: 'Type direct...',
      onsave,
      oncancel: vi.fn(),
    };

    const { getByPlaceholderText } = render(ActionListPopup, {
      props: {
        availableActions: [],
        onclose,
      },
    });

    const promptInput = getByPlaceholderText('Type direct...') as HTMLInputElement;
    await fireEvent.input(promptInput, { target: { value: 'Brand New Title' } });
    await fireEvent.keyDown(promptInput, { key: 'Enter' });

    expect(onsave).toHaveBeenCalledWith('Brand New Title');
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
