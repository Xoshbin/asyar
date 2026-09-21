/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

const mockListWindows = vi.fn();
const mockFocusWindow = vi.fn();
const mockCloseWindow = vi.fn();
const mockHideWindow = vi.fn();
const mockResetLauncherState = vi.fn();
const mockWriteText = vi.fn();
const mockRegisterAction = vi.fn();
const mockUnregisterAction = vi.fn();
const mockShowHUD = vi.fn();
const mockReport = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/windowManagement/windowManagementService', () => ({
  windowManagementService: {
    listWindows: () => mockListWindows(),
    focusWindow: (id: string) => mockFocusWindow(id),
    closeWindow: (id: string) => mockCloseWindow(id),
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  hideWindow: () => mockHideWindow(),
}));

vi.mock('../../lib/launcher/launcherReset', () => ({
  resetLauncherState: () => mockResetLauncherState(),
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: (t: string) => mockWriteText(t),
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: (a: any) => mockRegisterAction(a),
    unregisterAction: (id: string) => mockUnregisterAction(id),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    showHUD: (msg: string) => mockShowHUD(msg),
    report: (r: any) => mockReport(r),
  },
}));

vi.mock('../../services/i18n', () => ({
  t: (key: string) => key,
}));

import SwitchWindowsView from './SwitchWindowsView.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';

const SAMPLE_WINDOWS = [
  {
    id: 'win-1',
    pid: 101,
    appName: 'Safari',
    appBundleId: 'com.apple.Safari',
    title: 'GitHub - PR #123',
    isMinimized: false,
    isFocused: true,
    appIcon: null,
  },
  {
    id: 'win-2',
    pid: 202,
    appName: 'Code',
    appBundleId: 'com.microsoft.VSCode',
    title: 'SwitchWindowsView.svelte',
    isMinimized: true,
    isFocused: false,
    appIcon: null,
  },
];

async function flush(): Promise<void> {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await tick();
}

describe('SwitchWindowsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchStores.query = '';
    mockListWindows.mockResolvedValue([...SAMPLE_WINDOWS]);
    mockFocusWindow.mockResolvedValue(undefined);
    mockCloseWindow.mockResolvedValue(undefined);
    mockHideWindow.mockResolvedValue(undefined);
    mockWriteText.mockResolvedValue(undefined);
  });

  it('renders windows returned by windowManagementService', async () => {
    const { getByText } = render(SwitchWindowsView);
    await flush();

    expect(mockListWindows).toHaveBeenCalled();
    expect(getByText('GitHub - PR #123')).toBeTruthy();
    expect(getByText('SwitchWindowsView.svelte')).toBeTruthy();
  });

  it('renders active and minimized badges', async () => {
    const { getByText } = render(SwitchWindowsView);
    await flush();

    expect(getByText('features.window_management.badge_active')).toBeTruthy();
    expect(getByText('features.window_management.badge_minimized')).toBeTruthy();
  });

  it('filters windows based on search query', async () => {
    const { queryByText } = render(SwitchWindowsView);
    await flush();

    searchStores.query = 'safari';
    await flush();

    expect(queryByText('GitHub - PR #123')).toBeTruthy();
    expect(queryByText('SwitchWindowsView.svelte')).toBeNull();
  });

  it('shows empty state when no windows match query', async () => {
    const { getByText } = render(SwitchWindowsView);
    await flush();

    searchStores.query = 'nonexistent query 12345';
    await flush();

    expect(getByText('features.window_management.no_matching_windows')).toBeTruthy();
  });

  it('shows empty state when no windows exist', async () => {
    mockListWindows.mockResolvedValue([]);
    const { getByText } = render(SwitchWindowsView);
    await flush();

    expect(getByText('features.window_management.no_windows')).toBeTruthy();
  });

  it('switches to window and hides launcher on Enter', async () => {
    render(SwitchWindowsView);
    await flush();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(mockFocusWindow).toHaveBeenCalledWith('win-1');
    expect(mockHideWindow).toHaveBeenCalled();
    expect(mockResetLauncherState).toHaveBeenCalled();
  });

  it('navigates with ArrowDown and selects next window', async () => {
    render(SwitchWindowsView);
    await flush();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await flush();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(mockFocusWindow).toHaveBeenCalledWith('win-2');
  });

  it('registers actions for the selected window in action panel', async () => {
    render(SwitchWindowsView);
    await flush();

    const registeredIds = mockRegisterAction.mock.calls.map((c) => c[0].id);
    expect(registeredIds).toContain('window-management:focus-window');
    expect(registeredIds).toContain('window-management:close-window');
    expect(registeredIds).toContain('window-management:copy-title');

    // Test execute copy title
    const copyAction = mockRegisterAction.mock.calls.find(
      (c) => c[0].id === 'window-management:copy-title',
    )?.[0];
    await copyAction.execute();

    expect(mockWriteText).toHaveBeenCalledWith('GitHub - PR #123');
    expect(mockShowHUD).toHaveBeenCalledWith('features.window_management.title_copied');

    // Test execute close window
    const closeAction = mockRegisterAction.mock.calls.find(
      (c) => c[0].id === 'window-management:close-window',
    )?.[0];
    await closeAction.execute();

    expect(mockCloseWindow).toHaveBeenCalledWith('win-1');
    expect(mockListWindows).toHaveBeenCalledTimes(2);
  });
});
