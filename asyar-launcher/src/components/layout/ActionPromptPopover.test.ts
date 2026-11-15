// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ActionPromptPopover from './ActionPromptPopover.svelte';

vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));

describe('ActionPromptPopover', () => {
  it('renders title, input with initial value, and footer hints', () => {
    const { getByRole, getByDisplayValue, getByText } = render(ActionPromptPopover, {
      props: {
        title: 'Rename Entry...',
        value: 'My Old Name',
        contextLabel: 'Clipboard History',
        onsave: vi.fn(),
        oncancel: vi.fn(),
      },
    });

    expect(getByRole('dialog')).toBeTruthy();
    expect(getByText('Rename Entry...')).toBeTruthy();
    expect(getByDisplayValue('My Old Name')).toBeTruthy();
    expect(getByText('Clipboard History')).toBeTruthy();
  });

  it('calls onsave with the updated text when Enter is pressed', async () => {
    const onsave = vi.fn();
    const { getByRole } = render(ActionPromptPopover, {
      props: {
        title: 'Rename Entry...',
        value: 'Old Title',
        onsave,
        oncancel: vi.fn(),
      },
    });

    const input = getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'New Custom Title' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onsave).toHaveBeenCalledWith('New Custom Title');
  });

  it('clears input on first Escape, then calls oncancel on second Escape', async () => {
    const oncancel = vi.fn();
    const { getByRole } = render(ActionPromptPopover, {
      props: {
        title: 'Rename Entry...',
        value: 'Old Title',
        onsave: vi.fn(),
        oncancel,
      },
    });

    const input = getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Old Title');

    // First Escape: clears the text
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(oncancel).not.toHaveBeenCalled();

    // Second Escape: cancels / closes
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(oncancel).toHaveBeenCalledTimes(1);
  });

  it('calls oncancel immediately on Escape when input is already empty', async () => {
    const oncancel = vi.fn();
    const { getByRole } = render(ActionPromptPopover, {
      props: {
        title: 'Rename Entry...',
        value: '',
        onsave: vi.fn(),
        oncancel,
      },
    });

    const input = getByRole('textbox');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(oncancel).toHaveBeenCalledTimes(1);
  });

  it('calls oncancel on mousedown outside the popover', async () => {
    const oncancel = vi.fn();
    render(ActionPromptPopover, {
      props: {
        title: 'Rename Entry...',
        value: 'Old Title',
        onsave: vi.fn(),
        oncancel,
      },
    });

    await fireEvent.mouseDown(document.body);
    expect(oncancel).toHaveBeenCalled();
  });
});
