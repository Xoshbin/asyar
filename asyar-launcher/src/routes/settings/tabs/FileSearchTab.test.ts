// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const {
  currentSettingsMock,
  updateSettingsMock,
  getAllExtensionsWithStateMock,
  fileIndexStatusMock,
} = vi.hoisted(() => ({
  currentSettingsMock: {
    fileSearch: {
      enabled: true,
      rootSearchEnabled: true,
      includeRoots: [],
      excludePatterns: [],
      indexHidden: false,
      recentIgnorePatterns: [],
      providerStates: {},
    },
  },
  updateSettingsMock: vi.fn().mockResolvedValue(true),
  getAllExtensionsWithStateMock: vi.fn().mockReturnValue([]),
  fileIndexStatusMock: vi.fn().mockResolvedValue({
    state: 'ready',
    entryCount: 42,
    lastScanMs: 12,
    snapshotLoaded: false,
    capReached: false,
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    get currentSettings() {
      return currentSettingsMock;
    },
    updateSettings: updateSettingsMock,
  },
}));

vi.mock('../../../services/extension/extensionManager.svelte', () => ({
  default: {
    getAllExtensionsWithState: getAllExtensionsWithStateMock,
  },
}));

vi.mock('../../../lib/ipc/fileSearchCommands', () => ({
  fileIndexStatus: fileIndexStatusMock,
  fileIndexRebuild: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/ipc/commands', () => ({
  setFocusLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/ipc/bridgeEvents', () => ({
  appListen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

import FileSearchTab from './FileSearchTab.svelte';

describe('FileSearchTab - Cloud & Remote File Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSettingsMock.fileSearch = {
      enabled: true,
      rootSearchEnabled: true,
      includeRoots: [],
      excludePatterns: [],
      indexHidden: false,
      recentIgnorePatterns: [],
      providerStates: {},
    };
    getAllExtensionsWithStateMock.mockReturnValue([]);
  });

  it('renders empty hint when no cloud providers are installed', () => {
    render(FileSearchTab);
    expect(screen.getByText('Cloud & Remote File Search')).toBeTruthy();
    expect(screen.getByText('No remote file search providers installed')).toBeTruthy();
  });

  it('renders installed cloud providers and allows toggling them', async () => {
    getAllExtensionsWithStateMock.mockReturnValue([
      {
        id: 'org.example.gdrive',
        name: 'Google Drive Extension',
        enabled: true,
        fileSearchProviders: [
          {
            id: 'gdrive',
            name: 'Google Drive',
            description: 'Search your Google Docs and files',
            defaultEnabled: true,
          },
        ],
      },
    ]);

    render(FileSearchTab);
    expect(screen.getByText('Google Drive')).toBeTruthy();
    expect(screen.getByText('Search your Google Docs and files')).toBeTruthy();

    const toggles = screen.getAllByRole('checkbox');
    expect(toggles.length).toBeGreaterThanOrEqual(3);

    const providerToggle = toggles[toggles.length - 1];
    await fireEvent.click(providerToggle);

    expect(updateSettingsMock).toHaveBeenCalledWith('fileSearch', {
      providerStates: {
        'org.example.gdrive:gdrive': false,
      },
    });
  });
});
