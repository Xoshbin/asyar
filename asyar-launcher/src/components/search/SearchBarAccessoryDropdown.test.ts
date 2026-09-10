// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import SearchBarAccessoryDropdown from './SearchBarAccessoryDropdown.svelte';

describe('SearchBarAccessoryDropdown', () => {
  const options = [
    { value: 'all', title: 'All Items' },
    { value: 'active', title: 'Active Items' },
    { value: 'archived', title: 'Archived Items' },
  ];

  async function renderDropdown(props = {}) {
    const onChange = vi.fn();
    const onclose = vi.fn();
    const view = render(SearchBarAccessoryDropdown, {
      options,
      value: 'all',
      onChange,
      onclose,
      ...props,
    });
    const button = view.container.querySelector<HTMLButtonElement>('.accessory-button')!;
    return { view, button, onChange, onclose };
  }

  it.each(['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Tab'])(
    'leaves %s to the input method while composing in the filter input',
    async (key) => {
      const { view, button, onChange, onclose } = await renderDropdown();
      await fireEvent.click(button);
      await tick();

      const input = view.container.querySelector<HTMLInputElement>('.accessory-popover input')!;
      expect(input).not.toBeNull();

      const event = new KeyboardEvent('keydown', {
        key,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      await fireEvent(input, event);
      await tick();

      expect(event.defaultPrevented).toBe(false);
      expect(view.container.querySelector('.accessory-popover')).not.toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(onclose).not.toHaveBeenCalled();

      // After composition ends, Enter selects normally
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('all');
      expect(view.container.querySelector('.accessory-popover')).toBeNull();
    },
  );
});
