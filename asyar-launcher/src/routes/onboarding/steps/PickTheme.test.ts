// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const { invokeMock, listenMock, emitMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(() => Promise.resolve(() => {})),
  emitMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock, emit: emitMock }));

const fetchTopThemes = vi.hoisted(() => vi.fn());
const advanceStep = vi.hoisted(() => vi.fn());
const goBackStep = vi.hoisted(() => vi.fn());
const completeStep = vi.hoisted(() => vi.fn());
const installThemeExtension = vi.hoisted(() => vi.fn());
const applyInstalledTheme = vi.hoisted(() => vi.fn());
const removeTheme = vi.hoisted(() => vi.fn());
const discoverExtensions = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const listInstalledExtensions = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('../stepLogic', () => ({
  fetchTopThemes,
  advanceStep,
  goBackStep,
  completeStep,
}));

vi.mock('./themeSetup', () => ({
  installThemeExtension,
  applyInstalledTheme,
}));

vi.mock('../../../services/theme/themeService', () => ({
  removeTheme,
}));

vi.mock('../../../lib/ipc/commands', () => ({
  discoverExtensions,
  listInstalledExtensions,
}));

const { mockSettings } = vi.hoisted(() => ({
  mockSettings: {
    appearance: {
      activeTheme: null as string | null,
    },
  },
}));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    init: vi.fn().mockResolvedValue(undefined),
    currentSettings: mockSettings,
    updateSettings: vi.fn().mockImplementation(async (key, value) => {
      if (key === 'appearance') {
        Object.assign(mockSettings.appearance, value);
      }
    }),
  },
}));

vi.mock('../../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    report: vi.fn(),
  },
}));

vi.mock('../../../services/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'onboarding.theme_heading': 'Pick a look that fits your workspace',
      'onboarding.theme_desc': 'Themes change the palette, contrast, and accent highlights.',
      'settings.general.default_theme': 'Default Theme',
      'settings.general.default_theme_meta': 'Built-in Asyar theme',
      'settings.general.applied': 'Applied',
      'settings.general.use_default': 'Use default',
      'common.install': 'Install',
      'common.apply': 'Apply',
      'common.installing': 'Installing...',
      'common.loading': 'Loading...',
      'common.retry': 'Retry',
      'onboarding.theme_load_error': "Couldn't load themes.",
    };
    return map[key] ?? key;
  },
}));

import PickTheme from './PickTheme.svelte';

describe('PickTheme step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.appearance.activeTheme = null;
    discoverExtensions.mockResolvedValue([]);
    listInstalledExtensions.mockResolvedValue([]);
  });

  it('renders default theme tile with Applied by default', async () => {
    fetchTopThemes.mockResolvedValueOnce([]);

    render(PickTheme);

    expect(await screen.findByText('Default Theme')).toBeTruthy();
    expect(screen.getByText('Built-in Asyar theme')).toBeTruthy();
    expect(screen.getByText('Applied')).toBeTruthy();
  });

  it('renders available store themes with Install buttons', async () => {
    fetchTopThemes.mockResolvedValueOnce([
      {
        id: 'org.asyar.catppuccin',
        name: 'Catppuccin',
        description: 'Soothing pastel colors',
        manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
      },
    ]);

    render(PickTheme);

    expect(await screen.findByText('Catppuccin')).toBeTruthy();
    expect(screen.getByText('Soothing pastel colors')).toBeTruthy();
    const installBtn = screen.getByRole('button', { name: 'Install' });
    expect(installBtn).toBeTruthy();
  });

  it('installs and auto-applies a theme when Install is clicked', async () => {
    const theme = {
      id: 'org.asyar.catppuccin',
      name: 'Catppuccin',
      manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
    };
    fetchTopThemes.mockResolvedValueOnce([theme]);
    installThemeExtension.mockImplementation(async () => {
      discoverExtensions.mockResolvedValueOnce([
        {
          manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
          enabled: true,
          is_built_in: false,
          disableable: true,
          path: '/path/to/org.asyar.catppuccin',
        },
      ]);
    });

    render(PickTheme);

    const installBtn = await screen.findByRole('button', { name: 'Install' });
    await fireEvent.click(installBtn);

    await vi.waitFor(() => {
      expect(installThemeExtension).toHaveBeenCalledWith(theme);
      expect(applyInstalledTheme).toHaveBeenCalledWith('org.asyar.catppuccin');
    });
  });

  it('shows Apply button for installed themes that are not currently active', async () => {
    const theme = {
      id: 'org.asyar.catppuccin',
      name: 'Catppuccin',
      manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
    };
    fetchTopThemes.mockResolvedValueOnce([theme]);
    discoverExtensions.mockResolvedValueOnce([
      {
        manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
        enabled: true,
        is_built_in: false,
        disableable: true,
        path: '/path/to/org.asyar.catppuccin',
      },
    ]);

    render(PickTheme);

    expect(await screen.findByText('Catppuccin')).toBeTruthy();
    const applyBtn = screen.getByRole('button', { name: 'Apply' });
    expect(applyBtn).toBeTruthy();

    await fireEvent.click(applyBtn);
    expect(applyInstalledTheme).toHaveBeenCalledWith('org.asyar.catppuccin');
  });

  it('shows Applied status on the active theme', async () => {
    mockSettings.appearance.activeTheme = 'org.asyar.catppuccin';
    const theme = {
      id: 'org.asyar.catppuccin',
      name: 'Catppuccin',
      manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
    };
    fetchTopThemes.mockResolvedValueOnce([theme]);
    discoverExtensions.mockResolvedValueOnce([
      {
        manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
        enabled: true,
        is_built_in: false,
        disableable: true,
        path: '/path/to/org.asyar.catppuccin',
      },
    ]);

    render(PickTheme);

    expect(await screen.findByText('Catppuccin')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use default' })).toBeTruthy();
    const appliedElements = screen.getAllByText('Applied');
    expect(appliedElements.length).toBe(1);
  });

  it('allows reverting to default theme when an active custom theme is set', async () => {
    mockSettings.appearance.activeTheme = 'org.asyar.catppuccin';
    const theme = {
      id: 'org.asyar.catppuccin',
      name: 'Catppuccin',
      manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
    };
    fetchTopThemes.mockResolvedValueOnce([theme]);

    render(PickTheme);

    const useDefaultBtn = await screen.findByRole('button', { name: 'Use default' });
    await fireEvent.click(useDefaultBtn);

    expect(removeTheme).toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith('asyar:theme-changed', { themeId: null });
  });

  it('shows retry button when theme loading fails and retains default theme', async () => {
    fetchTopThemes.mockResolvedValueOnce([]);

    render(PickTheme);

    expect(await screen.findByText('Default Theme')).toBeTruthy();
    expect(screen.getByText("Couldn't load themes.")).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    expect(retryBtn).toBeTruthy();

    fetchTopThemes.mockResolvedValueOnce([
      {
        id: 'org.asyar.catppuccin',
        name: 'Catppuccin',
        manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
      },
    ]);
    await fireEvent.click(retryBtn);

    expect(await screen.findByText('Catppuccin')).toBeTruthy();
  });

  it('installs and applies when clicking anywhere on the theme card', async () => {
    const theme = {
      id: 'org.asyar.catppuccin',
      name: 'Catppuccin',
      manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
    };
    fetchTopThemes.mockResolvedValueOnce([theme]);
    installThemeExtension.mockImplementation(async () => {
      discoverExtensions.mockResolvedValueOnce([
        {
          manifest: { id: 'org.asyar.catppuccin', name: 'Catppuccin', type: 'theme' },
          enabled: true,
          is_built_in: false,
          disableable: true,
          path: '/path/to/org.asyar.catppuccin',
        },
      ]);
    });

    render(PickTheme);

    const card = await screen.findByText('Catppuccin');
    await fireEvent.click(card);

    await vi.waitFor(() => {
      expect(installThemeExtension).toHaveBeenCalledWith(theme);
      expect(applyInstalledTheme).toHaveBeenCalledWith('org.asyar.catppuccin');
    });
  });
});
