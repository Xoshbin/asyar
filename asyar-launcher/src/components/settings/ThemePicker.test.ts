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

  it('previews the Default card in the built-in palette, not the active theme', () => {
    render(ThemePicker, {
      props: { themes, activeId: 'nord', onselect: vi.fn(), ongetmore: vi.fn() },
    });

    const minis = screen.getAllByRole('radio').map((r) => r.querySelector('.mini'));
    expect(minis.map((m) => m?.classList.contains('builtin'))).toEqual([true, false]);
  });

  it('offers more themes even when none are installed', async () => {
    const ongetmore = vi.fn();
    render(ThemePicker, { props: { themes: [], activeId: null, onselect: vi.fn(), ongetmore } });

    await fireEvent.click(screen.getByText('Get more themes'));
    expect(ongetmore).toHaveBeenCalled();
  });

  it('expands multi-variant themes into individual cards and selects variant ID', async () => {
    const { getThemeDefinition } = await import('../../lib/ipc/commands');
    vi.mocked(getThemeDefinition).mockResolvedValueOnce({
      variables: {},
      fonts: [],
      variants: [
        {
          id: 'night',
          name: 'Night',
          appearance: 'dark',
          variables: { '--bg-primary': '#1a1b26' },
        },
        { id: 'day', name: 'Day', appearance: 'light', variables: { '--bg-primary': '#e1e2e7' } },
      ],
    });

    const onselect = vi.fn();
    render(ThemePicker, {
      props: {
        themes: [
          { id: 'org.asyar.tokyo-night', name: 'Tokyo Night', author: 'Asyar', version: '1.0.0' },
        ],
        activeId: 'org.asyar.tokyo-night#day',
        onselect,
        ongetmore: vi.fn(),
      },
    });

    const dayCard = await screen.findByText('Tokyo Night · Day');
    expect(screen.getByText('Tokyo Night · Night')).toBeTruthy();

    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);

    await fireEvent.click(dayCard);
    expect(onselect).toHaveBeenCalledWith('org.asyar.tokyo-night#day');
  });
});
