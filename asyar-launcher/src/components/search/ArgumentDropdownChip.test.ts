// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { CommandArgument } from 'asyar-sdk/contracts';

import ArgumentDropdownChip from './ArgumentDropdownChip.svelte';

const ARG: CommandArgument = {
  name: 'scope',
  type: 'dropdown',
  placeholder: 'Scope',
  data: [
    { value: 'active', title: 'Active' },
    { value: 'all', title: 'All' },
    { value: 'archived', title: 'Archived' },
  ],
};

async function renderChip(props: { value?: string; touched?: boolean; readonly?: boolean } = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onReset: vi.fn(),
    onKeydown: vi.fn(),
  };
  const view = render(ArgumentDropdownChip, {
    arg: ARG,
    value: props.value ?? 'active',
    touched: props.touched ?? false,
    focused: true,
    readonly: props.readonly ?? false,
    ...handlers,
  });
  await tick();
  const trigger = view.container.querySelector<HTMLButtonElement>('.arg-trigger')!;
  const optionTitles = () =>
    Array.from(view.container.querySelectorAll('.arg-popover-list .result-title')).map((el) =>
      el.textContent?.trim(),
    );
  const filter = () => view.container.querySelector<HTMLInputElement>('.arg-popover-search input');
  const highlighted = () =>
    view.container.querySelector('.selected-result .result-title')?.textContent?.trim();
  return { ...handlers, view, trigger, optionTitles, filter, highlighted };
}

describe('ArgumentDropdownChip', () => {
  it('shows the seeded option greyed until the user picks something', async () => {
    const untouched = await renderChip();
    expect(untouched.trigger.textContent).toContain('Active');
    expect(untouched.trigger.classList.contains('arg-trigger--touched')).toBe(false);

    const picked = await renderChip({ touched: true });
    expect(picked.trigger.classList.contains('arg-trigger--touched')).toBe(true);
  });

  it('falls back to the placeholder when nothing is seeded', async () => {
    const { trigger } = await renderChip({ value: '' });
    expect(trigger.textContent).toContain('Scope');
  });

  it('Down walks the options and Up off the first one resets the field', async () => {
    const first = await renderChip();
    await fireEvent.keyDown(first.trigger, { key: 'ArrowDown' });
    // The seeded slot sits before the first option, so Down lands on it:
    // same title, now the user's own pick.
    expect(first.onSelect).toHaveBeenCalledWith('active');

    const second = await renderChip({ value: 'active', touched: true });
    await fireEvent.keyDown(second.trigger, { key: 'ArrowDown' });
    expect(second.onSelect).toHaveBeenCalledWith('all');

    const back = await renderChip({ value: 'active', touched: true });
    await fireEvent.keyDown(back.trigger, { key: 'ArrowUp' });
    expect(back.onReset).toHaveBeenCalled();
    expect(back.onSelect).not.toHaveBeenCalled();
  });

  it('neither end of the closed list wraps', async () => {
    const top = await renderChip();
    await fireEvent.keyDown(top.trigger, { key: 'ArrowUp' });
    expect(top.onReset).not.toHaveBeenCalled();
    expect(top.onSelect).not.toHaveBeenCalled();

    const bottom = await renderChip({ value: 'archived', touched: true });
    await fireEvent.keyDown(bottom.trigger, { key: 'ArrowDown' });
    expect(bottom.onSelect).not.toHaveBeenCalled();
  });

  it('typing opens the list on that keystroke and filters by it', async () => {
    const { trigger, filter, optionTitles } = await renderChip();
    await fireEvent.keyDown(trigger, { key: 'a' });
    await tick();
    expect(filter()?.value).toBe('a');
    // No "-" row while filtering: a search is over real options.
    expect(optionTitles()).toEqual(['Active', 'All', 'Archived']);

    await fireEvent.input(filter()!, { target: { value: 'al' } });
    await tick();
    expect(optionTitles()).toEqual(['All']);
  });

  it('says so when the query matches nothing', async () => {
    const { trigger, filter, view } = await renderChip();
    await fireEvent.keyDown(trigger, { key: 'z' });
    await tick();
    expect(filter()?.value).toBe('z');
    expect(view.container.querySelector('.empty-state')?.textContent).toContain('No results found');
  });

  it('clicking toggles the list, and the chevron follows', async () => {
    const { trigger, view, filter } = await renderChip();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(trigger);
    await tick();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(filter()?.value).toBe('');
    expect(view.container.querySelector('.arg-chevron--up')).not.toBeNull();

    await fireEvent.click(trigger);
    await tick();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('.arg-chevron--up')).toBeNull();
  });

  it('opens with the seeded slot highlighted, and the current pick when there is one', async () => {
    const untouched = await renderChip();
    await fireEvent.click(untouched.trigger);
    await tick();
    expect(untouched.optionTitles()).toEqual(['-', 'Active', 'All', 'Archived']);
    expect(untouched.highlighted()).toBe('-');

    const picked = await renderChip({ value: 'all', touched: true });
    await fireEvent.click(picked.trigger);
    await tick();
    expect(picked.highlighted()).toBe('All');
  });

  it('the open list stops at both ends instead of wrapping', async () => {
    const { trigger, filter, highlighted } = await renderChip();
    await fireEvent.click(trigger);
    await tick();
    expect(highlighted()).toBe('-');
    await fireEvent.keyDown(filter()!, { key: 'ArrowUp' });
    expect(highlighted()).toBe('-');
    for (let i = 0; i < 6; i++) await fireEvent.keyDown(filter()!, { key: 'ArrowDown' });
    expect(highlighted()).toBe('Archived');
  });

  it('Enter takes the highlighted option, and the "-" row resets the field', async () => {
    const { trigger, filter, onSelect } = await renderChip();
    await fireEvent.click(trigger);
    await tick();
    await fireEvent.keyDown(filter()!, { key: 'ArrowDown' });
    await fireEvent.keyDown(filter()!, { key: 'ArrowDown' });
    await fireEvent.keyDown(filter()!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('all');

    const reset = await renderChip({ value: 'all', touched: true });
    await fireEvent.click(reset.trigger);
    await tick();
    await fireEvent.keyDown(reset.filter()!, { key: 'ArrowUp' });
    await fireEvent.keyDown(reset.filter()!, { key: 'ArrowUp' });
    expect(reset.highlighted()).toBe('-');
    await fireEvent.keyDown(reset.filter()!, { key: 'Enter' });
    expect(reset.onReset).toHaveBeenCalled();
  });

  it('deleting the query keeps the list up; Escape clears it, then closes it', async () => {
    const { trigger, filter, view, optionTitles, onKeydown } = await renderChip();
    await fireEvent.keyDown(trigger, { key: 'a' });
    await tick();

    await fireEvent.input(filter()!, { target: { value: '' } });
    await tick();
    expect(view.container.querySelector('.arg-popover')).not.toBeNull();
    expect(optionTitles()).toEqual(['-', 'Active', 'All', 'Archived']);

    // With text in the box, Escape empties it and leaves the list up.
    await fireEvent.input(filter()!, { target: { value: 'al' } });
    await fireEvent.keyDown(filter()!, { key: 'Escape' });
    await tick();
    expect(filter()?.value).toBe('');
    expect(view.container.querySelector('.arg-popover')).not.toBeNull();

    await fireEvent.keyDown(filter()!, { key: 'Escape' });
    await tick();
    expect(view.container.querySelector('.arg-popover')).toBeNull();
    // The chip keeps focus, so the next keystroke opens the list again.
    expect(document.activeElement).toBe(trigger);
    expect(onKeydown).not.toHaveBeenCalled();

    await fireEvent.keyDown(trigger, { key: 'b' });
    await tick();
    expect(view.container.querySelector('.arg-popover')).not.toBeNull();
  });

  it('hands keys it does not own to the field row', async () => {
    const { trigger, onKeydown } = await renderChip();
    await fireEvent.keyDown(trigger, { key: 'Tab' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onKeydown.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual([
      'Tab',
      'Enter',
      'Escape',
    ]);
  });

  it('Tab out of an open list closes it and hands Tab on', async () => {
    const { trigger, filter, view, onKeydown } = await renderChip();
    await fireEvent.click(trigger);
    await tick();
    await fireEvent.keyDown(filter()!, { key: 'Tab' });
    await tick();
    await tick();
    expect(view.container.querySelector('.arg-popover')).toBeNull();
    expect(onKeydown).toHaveBeenCalledTimes(1);
    // Whoever the row handed focus to keeps it: closing the list must not
    // pull it back to a field Tab has already left.
    expect(document.activeElement).not.toBe(trigger);
  });

  it('Backspace clears a picked value instead of leaving the row', async () => {
    const picked = await renderChip({ touched: true });
    await fireEvent.keyDown(picked.trigger, { key: 'Backspace' });
    expect(picked.onReset).toHaveBeenCalled();
    expect(picked.onKeydown).not.toHaveBeenCalled();

    // Untouched, there is nothing of the user's to clear: the row decides.
    const seeded = await renderChip();
    await fireEvent.keyDown(seeded.trigger, { key: 'Backspace' });
    expect(seeded.onReset).not.toHaveBeenCalled();
    expect(seeded.onKeydown).toHaveBeenCalled();
  });

  // Regression: a real press is mousedown, then click. The press moved focus
  // off the search box, the list closes itself once focus leaves, and the row
  // was gone before the click that was about to pick it ever landed. Only a
  // synthetic `click` hid this, which is all the tests above fire.
  it('survives the press that precedes the click on a row', async () => {
    const { trigger, filter, view, onSelect } = await renderChip();
    await fireEvent.click(trigger);
    await tick();
    expect(document.activeElement).toBe(filter());

    const row = view.container.querySelectorAll<HTMLElement>('.arg-popover-list .result-item')[3];
    const press = await fireEvent.mouseDown(row);

    expect(press).toBe(false); // defaultPrevented: focus never moves
    expect(document.activeElement).toBe(filter());
    await tick();
    expect(view.container.querySelector('.arg-popover')).not.toBeNull();

    await fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('archived');
  });

  it('leaves the search box itself clickable', async () => {
    const { trigger, filter, view } = await renderChip();
    await fireEvent.click(trigger);
    await tick();
    // The guard is on the list alone, so the caret can still be placed.
    expect(await fireEvent.mouseDown(filter()!)).toBe(true);
    expect(view.container.querySelector('.arg-popover')).not.toBeNull();
  });

  it('marks the trigger as where the caret belongs, since a button is not an input', async () => {
    // The launcher's click handler does not count a focused button as focus,
    // so without this it would pull the caret to the query behind the chips.
    const { trigger, view } = await renderChip();
    expect(view.container.querySelector('[data-arg-focus-target]')).toBe(trigger);

    const ghost = await renderChip({ readonly: true });
    expect(ghost.view.container.querySelector('[data-arg-focus-target]')).toBeNull();
  });

  it('a ghost chip neither takes focus nor opens', async () => {
    const { trigger, view } = await renderChip({ readonly: true });
    expect(trigger.tabIndex).toBe(-1);
    expect(document.activeElement).not.toBe(trigger);
    await fireEvent.keyDown(trigger, { key: 'a' });
    await tick();
    expect(view.container.querySelector('.arg-popover')).toBeNull();
  });
});
