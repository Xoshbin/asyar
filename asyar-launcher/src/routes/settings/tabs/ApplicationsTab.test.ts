// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const {
  emitMock,
  validateScanPathMock,
  updateSettingsMock,
  setApplicationEnabledMock,
  listApplicationsMock,
  openMock,
} = vi.hoisted(() => ({
  emitMock: vi.fn(async () => {}),
  validateScanPathMock: vi.fn(
    async (path: string): Promise<{ normalizedPath: string | null; error: string | null }> => ({
      normalizedPath: path.trim().replace(/\/$/, ''),
      error: null,
    }),
  ),
  updateSettingsMock: vi.fn(async () => true),
  setApplicationEnabledMock: vi.fn(async () => true),
  listApplicationsMock: vi.fn(async () => []),
  openMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openMock }));

vi.mock('../../../lib/ipc/commands', () => ({
  getDefaultAppScanPaths: vi.fn(async () => ['/Applications']),
  listApplications: listApplicationsMock,
  validateApplicationScanPath: validateScanPathMock,
  setFocusLock: vi.fn(async () => {}),
}));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      search: {
        additionalScanPaths: [],
        applicationEnabled: {},
      },
    },
    updateSettings: updateSettingsMock,
    setApplicationEnabled: setApplicationEnabledMock,
  },
}));

vi.mock('../../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../services/i18n', () => ({
  t: (key: string, params?: Record<string, string>) => {
    const value =
      {
        'settings.applications.add_path_label': 'Application directory path',
        'settings.applications.add_path_placeholder': '/Applications/Utilities',
        'settings.applications.add_path_action': 'Add path',
        'settings.applications.browse_action': 'Choose folder…',
        'settings.applications.error_empty_path': 'Enter an application directory path',
        'settings.applications.error_duplicate_path': '{path} is already in the search scope',
        'settings.applications.error_not_found': '{path} does not exist',
        'settings.applications.error_save_paths': 'Failed to save directory list',
        'settings.applications.error_refresh_paths':
          'The directory was saved, but the application index could not refresh. Restart Asyar to retry.',
      }[key] ?? key;
    return params ? value.replaceAll('{path}', params.path ?? '') : value;
  },
}));

vi.mock('../../../built-in-features/shortcuts/shortcutStore.svelte', () => ({
  shortcutStore: { shortcuts: [] },
}));
vi.mock('../../../built-in-features/shortcuts/shortcutService', () => ({
  shortcutService: { register: vi.fn(), unregister: vi.fn() },
}));
vi.mock('../../../built-in-features/aliases/aliasStore.svelte', () => ({
  aliasStore: { byObjectId: new Map(), refresh: vi.fn(async () => {}) },
}));
vi.mock('../../../built-in-features/aliases/aliasService', () => ({
  aliasService: { unregister: vi.fn() },
}));

import ApplicationsTab from './ApplicationsTab.svelte';
import { applicationsCache, resetApplicationsCache } from './applicationsCache.svelte';

describe('Settings → Applications path entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApplicationsCache();
    validateScanPathMock.mockImplementation(async (path: string) => ({
      normalizedPath: path.trim().replace(/\/$/, ''),
      error: null,
    }));
    updateSettingsMock.mockResolvedValue(true);
    listApplicationsMock.mockResolvedValue([]);
  });

  it('adds a pasted path through the same normalized settings flow', async () => {
    render(ApplicationsTab);

    const input = await screen.findByLabelText('Application directory path');
    await fireEvent.input(input, {
      target: { value: '  /Applications/Xcode.app/Contents/Applications/  ' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    await waitFor(() => {
      expect(validateScanPathMock).toHaveBeenCalledWith(
        '/Applications/Xcode.app/Contents/Applications/',
        [],
      );
      expect(updateSettingsMock).toHaveBeenCalledWith('search', {
        additionalScanPaths: ['/Applications/Xcode.app/Contents/Applications'],
      });
    });
    expect(emitMock).toHaveBeenCalledWith('asyar:app-scan-paths-changed', {
      additionalScanPaths: ['/Applications/Xcode.app/Contents/Applications'],
    });
    expect(listApplicationsMock).toHaveBeenLastCalledWith([
      '/Applications/Xcode.app/Contents/Applications',
    ]);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });

  it('keeps the folder picker available beside direct path entry', async () => {
    render(ApplicationsTab);

    await screen.findByLabelText('Application directory path');
    expect(
      (screen.getByRole('button', { name: 'Choose folder…' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('shows an actionable error for an empty path', async () => {
    render(ApplicationsTab);

    await screen.findByLabelText('Application directory path');
    await fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Enter an application directory path',
    );
    expect(validateScanPathMock).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('explains when a normalized path is already scanned by default', async () => {
    validateScanPathMock.mockResolvedValueOnce({ normalizedPath: null, error: 'duplicate' });
    render(ApplicationsTab);

    const input = await screen.findByLabelText('Application directory path');
    await fireEvent.input(input, { target: { value: '/Applications/' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      '/Applications/ is already in the search scope',
    );
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('shows the Rust validation reason for a path that does not exist', async () => {
    validateScanPathMock.mockResolvedValueOnce({ normalizedPath: null, error: 'not_found' });
    render(ApplicationsTab);

    const input = await screen.findByLabelText('Application directory path');
    await fireEvent.input(input, { target: { value: '/missing/apps' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      '/missing/apps does not exist',
    );
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('runs picker selections through the same validation and persistence flow', async () => {
    openMock.mockResolvedValueOnce('/Applications/Utilities/');
    render(ApplicationsTab);

    await fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));

    await waitFor(() => {
      expect(validateScanPathMock).toHaveBeenCalledWith('/Applications/Utilities/', []);
      expect(updateSettingsMock).toHaveBeenCalledWith('search', {
        additionalScanPaths: ['/Applications/Utilities'],
      });
    });
  });

  it('reports a persistence failure without leaving path entry disabled', async () => {
    updateSettingsMock.mockRejectedValueOnce(new Error('disk full'));
    render(ApplicationsTab);

    const input = await screen.findByLabelText('Application directory path');
    await fireEvent.input(input, { target: { value: '/Applications/Tools' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Failed to save directory list',
    );
    expect((screen.getByRole('button', { name: 'Add path' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('reports a post-save index refresh failure while keeping the saved path complete', async () => {
    emitMock.mockRejectedValueOnce(new Error('event unavailable'));
    render(ApplicationsTab);

    const input = await screen.findByLabelText('Application directory path');
    await fireEvent.input(input, { target: { value: '/Applications/Tools' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The directory was saved, but the application index could not refresh',
    );
    expect(updateSettingsMock).toHaveBeenCalled();
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });
});

describe('Settings → Applications cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApplicationsCache();
    listApplicationsMock.mockResolvedValue([]);
  });

  it('shows the loading state on the very first visit', () => {
    render(ApplicationsTab);
    expect(screen.getByText('common.loading')).toBeTruthy();
  });

  it('renders cached apps on frame 0 without a loading flash, then refreshes silently', async () => {
    applicationsCache.defaultPaths = ['/Applications'];
    applicationsCache.apps = [{ id: 'a1', name: 'Cached App' } as never];
    applicationsCache.hasLoadedOnce = true;
    listApplicationsMock.mockResolvedValue([{ id: 'a2', name: 'Fresh App' }] as never);

    render(ApplicationsTab);
    expect(screen.queryByText('common.loading')).toBeNull();
    expect(screen.getByText('Cached App')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Fresh App')).toBeTruthy());
    expect(screen.queryByText('common.loading')).toBeNull();
    expect(applicationsCache.apps.map((a) => a.id)).toEqual(['a2']);
  });

  it('keeps the cached list when the silent refresh fails', async () => {
    applicationsCache.apps = [{ id: 'a1', name: 'Cached App' } as never];
    applicationsCache.hasLoadedOnce = true;
    listApplicationsMock.mockRejectedValue(new Error('boom'));

    render(ApplicationsTab);
    await waitFor(() => expect(listApplicationsMock).toHaveBeenCalled());
    expect(screen.getByText('Cached App')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Settings → Applications enable toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApplicationsCache();
    listApplicationsMock.mockResolvedValue([]);
  });

  it('flips one application through the keyed setter, not a whole-section replace', async () => {
    applicationsCache.apps = [{ id: 'a1', name: 'Cached App' } as never];
    applicationsCache.hasLoadedOnce = true;
    render(ApplicationsTab);

    const boxes = screen.getAllByRole('checkbox');
    await fireEvent.click(boxes[boxes.length - 1]);

    expect(setApplicationEnabledMock).toHaveBeenCalledWith('a1', false);
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });
});
