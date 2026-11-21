// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  currentSettingsMock,
  emitMock,
  feedbackReportMock,
  logErrorMock,
  setUiScaleMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  currentSettingsMock: { appearance: { uiScale: 1.2 } },
  emitMock: vi.fn().mockResolvedValue(undefined),
  feedbackReportMock: vi.fn(),
  logErrorMock: vi.fn(),
  setUiScaleMock: vi.fn().mockResolvedValue(undefined),
  updateSettingsMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../../lib/ipc/commands', () => ({
  discoverExtensions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../lib/ipc/windowCommands', () => ({
  registerLauncherResetHook: vi.fn(),
  setUiScale: setUiScaleMock,
}));

vi.mock('../../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: feedbackReportMock },
}));

vi.mock('../../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logErrorMock,
  },
}));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: currentSettingsMock,
    updateSettings: updateSettingsMock,
  },
}));

vi.mock('../../../services/theme/themeService', () => ({
  applyTheme: vi.fn(),
  removeTheme: vi.fn(),
}));

vi.mock('../../../lib/keyboard/hostPlatform', () => ({ getHostPlatform: () => 'macos' }));

import AppearanceTab from './AppearanceTab.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

function createHandler(activeTheme: string | null = null): SettingsHandler {
  return {
    settings: {
      appearance: { activeTheme },
    },
    selectedTheme: 'system',
    selectedLaunchView: 'default',
    updateThemeSetting: vi.fn(),
    updateLaunchView: vi.fn(),
  } as unknown as SettingsHandler;
}

function comboboxWithOption(value: string): HTMLSelectElement {
  return screen
    .getAllByRole('combobox')
    .find((c) =>
      Array.from((c as HTMLSelectElement).options).some((o) => o.value === value),
    ) as HTMLSelectElement;
}

describe('AppearanceTab interface size', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSettingsMock.appearance.uiScale = 1.2;
  });

  it('shows the persisted scale and applies a selected scale to settings and the native window', async () => {
    render(AppearanceTab, { props: { handler: createHandler() } });

    expect(screen.getByText('Interface Size')).toBeTruthy();

    const select = comboboxWithOption('1.2');
    expect(select.value).toBe('1.2');
    expect((screen.getByRole('option', { name: 'Large' }) as HTMLOptionElement).value).toBe('1.1');

    await fireEvent.change(select, { target: { value: '1.1' } });

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith('appearance', { uiScale: 1.1 });
      expect(setUiScaleMock).toHaveBeenCalledWith(1.1);
    });
  });

  it('does not resize the native window when persisting the scale fails', async () => {
    updateSettingsMock.mockImplementationOnce(async (_section, values) => {
      Object.assign(currentSettingsMock.appearance, values);
      return false;
    });
    render(AppearanceTab, { props: { handler: createHandler() } });

    const select = comboboxWithOption('1.2');
    await fireEvent.change(select, { target: { value: '1.1' } });

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith('appearance', { uiScale: 1.1 });
    });
    expect(setUiScaleMock).not.toHaveBeenCalled();
    expect(currentSettingsMock.appearance.uiScale).toBe(1.2);
    expect((select as HTMLSelectElement).value).toBe('1.2');
    expect(logErrorMock).toHaveBeenCalledWith('Failed to update interface size');
    expect(feedbackReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        context: { message: 'Could not save the interface size' },
      }),
    );
  });
});

describe('AppearanceTab window opacity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts at the platform default and saves the chosen opacity', async () => {
    render(AppearanceTab, { props: { handler: createHandler() } });

    const slider = screen.getByRole('slider', { name: 'Window opacity' }) as HTMLInputElement;
    expect(slider.value).toBe('65');
    await fireEvent.input(slider, { target: { value: '100' } });

    expect(updateSettingsMock).toHaveBeenCalledWith('appearance', { windowOpacity: 100 });
  });

  it('hands control to an active custom theme', async () => {
    render(AppearanceTab, { props: { handler: createHandler('nord') } });

    await waitFor(() =>
      expect(
        (screen.getByRole('slider', { name: 'Window opacity' }) as HTMLInputElement).disabled,
      ).toBe(true),
    );
    expect(screen.getByText('Set by the active theme.')).toBeTruthy();
  });
});
