// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('../../lib/ipc/commands', () => ({
  getThemeDefinition: vi.fn().mockResolvedValue({
    variables: { '--bg-primary': 'rgb(1, 2, 3)' },
    fonts: [],
  }),
}));

import ThemePicker from './ThemePicker.svelte';

const themes = [{ id: 'nord', name: 'Nord', author: 'Arctic', version: '1.2.0' }];

describe('ThemePicker', () => {
  it('marks the active theme and selects another', async () => {
    const onselect = vi.fn();
    render(ThemePicker, { props: { themes, activeId: 'nord', onselect, ongetmore: vi.fn() } });

    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);

    await fireEvent.click(radios[0]);
    expect(onselect).toHaveBeenCalledWith(null);
  });

  it('offers more themes even when none are installed', async () => {
    const ongetmore = vi.fn();
    render(ThemePicker, { props: { themes: [], activeId: null, onselect: vi.fn(), ongetmore } });

    await fireEvent.click(screen.getByText('Get more themes'));
    expect(ongetmore).toHaveBeenCalled();
  });
});
