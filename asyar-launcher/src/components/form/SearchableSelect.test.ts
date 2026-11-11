// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SearchableSelect from './SearchableSelect.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

const OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'kmr', label: 'Kurdish (Kurmanji)' },
  { value: 'ckb', label: 'Kurdish (Sorani)' },
  { value: 'fr', label: 'French' },
];

describe('SearchableSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens on Enter, filters by typing, navigates with arrows, and selects with Enter', async () => {
    const onchange = vi.fn();
    render(SearchableSelect, {
      options: OPTIONS,
      value: 'en',
      onchange,
    });

    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toContain('English');

    await fireEvent.keyDown(trigger, { key: 'Enter' });

    const filterInput = screen.getByPlaceholderText(/filter/i) as HTMLInputElement;
    await fireEvent.input(filterInput, { target: { value: 'ku' } });

    const opts = screen.getAllByRole('option');
    expect(opts).toHaveLength(2);
    expect(opts[0].textContent).toContain('Kurdish (Kurmanji)');
    expect(opts[1].textContent).toContain('Kurdish (Sorani)');

    await fireEvent.keyDown(filterInput, { key: 'ArrowDown' });
    await fireEvent.keyDown(filterInput, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledWith('ckb');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('intercepts viewManager Escape while open before closing outer view', async () => {
    render(SearchableSelect, {
      options: OPTIONS,
      value: 'en',
    });

    const trigger = screen.getByRole('combobox');
    await fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('listbox')).toBeTruthy();

    expect(viewManager.tryInterceptEscape()).toBe(true);
    await Promise.resolve();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

it('resets highlight when filtering and identifies the active option', async () => {
  render(SearchableSelect, { options: OPTIONS, value: 'ckb' });
  await fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  const input = screen.getByPlaceholderText(/filter/i);
  expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2].id);
  await fireEvent.input(input, { target: { value: 'ku' } });
  expect(screen.getAllByRole('option')[0].classList.contains('highlighted')).toBe(true);
  expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
});
