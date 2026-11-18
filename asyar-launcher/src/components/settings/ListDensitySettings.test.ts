// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { LIST_DENSITY_PRESETS } from '../../lib/launcher/listDensity';

const { settings, mockUpdateSettings } = vi.hoisted(() => ({
  settings: { appearance: {} as Record<string, unknown> },
  mockUpdateSettings: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { currentSettings: settings, updateSettings: mockUpdateSettings },
}));

import ListDensitySettings from './ListDensitySettings.svelte';

describe('ListDensitySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.appearance = {};
  });

  it('seeds Custom with the current preset so switching changes nothing on screen', async () => {
    settings.appearance = { listDensity: 'dense' };
    render(ListDensitySettings);

    await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } });

    expect(mockUpdateSettings).toHaveBeenCalledWith('appearance', {
      listDensity: 'custom',
      customListDensity: LIST_DENSITY_PRESETS.dense,
    });
  });

  it('shows the custom sliders only for Custom', () => {
    const { unmount } = render(ListDensitySettings);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    unmount();

    settings.appearance = { listDensity: 'custom' };
    render(ListDensitySettings);
    expect(screen.getAllByRole('slider')).toHaveLength(4);
  });
});
