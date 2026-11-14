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

  it('supports in-place submenu navigation with Enter/ArrowRight and Escape/Backspace back', async () => {
    const nestedOptions = [
      { value: 'all', title: 'All Types', selected: false },
      { value: 'images', title: 'Images', selected: true },
      {
        value: 'submenu:app',
        title: 'Filter by App',
        subtitle: 'VS Code',
        children: [
          { value: 'app:all', title: 'All Apps', selected: false },
          { value: 'app:VS Code', title: 'VS Code', subtitle: '12', selected: true },
          { value: 'app:Chrome', title: 'Chrome', subtitle: '5', selected: false },
        ],
      },
    ];

    const { view, button, onChange, onclose } = await renderDropdown({
      options: nestedOptions,
      value: 'images',
      buttonTitle: 'Images · VS Code',
    });

    expect(button.textContent).toContain('Images · VS Code');

    await fireEvent.click(button);
    await tick();

    const input = view.container.querySelector<HTMLInputElement>('.accessory-filter-input')!;
    expect(view.container.textContent).toContain('Filter by App');

    // Navigate down once from selected "Images" (index 1) to "Filter by App" (index 2) and press ArrowRight
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'ArrowRight' });
    await tick();

    expect(view.container.querySelector('.accessory-submenu-back')?.textContent).toContain(
      'Filter by App',
    );
    expect(view.container.textContent).toContain('All Apps');
    expect(view.container.textContent).toContain('Chrome');
    expect(onChange).not.toHaveBeenCalled();

    // Pressing Escape inside submenu returns to parent list instead of closing popover
    await fireEvent.keyDown(input, { key: 'Escape' });
    await tick();
    expect(view.container.querySelector('.accessory-popover')).not.toBeNull();
    expect(view.container.querySelector('.accessory-submenu-back')).toBeNull();
    expect(onclose).not.toHaveBeenCalled();

    // Enter opens submenu again; Backspace with empty filter goes back
    await fireEvent.keyDown(input, { key: 'Enter' });
    await tick();
    expect(view.container.querySelector('.accessory-submenu-back')).not.toBeNull();
    await fireEvent.keyDown(input, { key: 'Backspace' });
    await tick();
    expect(view.container.querySelector('.accessory-submenu-back')).toBeNull();

    // Re-enter submenu via click and pick Chrome
    const appRow = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.accessory-option'),
    ).find((el) => el.textContent?.includes('Filter by App'))!;
    await fireEvent.click(appRow);
    await tick();

    const chromeRow = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.accessory-option'),
    ).find((el) => el.textContent?.includes('Chrome'))!;
    await fireEvent.click(chromeRow);
    await tick();

    expect(onChange).toHaveBeenCalledWith('app:Chrome');
    expect(view.container.querySelector('.accessory-popover')).toBeNull();
  });
});
