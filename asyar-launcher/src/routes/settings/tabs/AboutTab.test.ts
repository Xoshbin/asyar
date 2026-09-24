// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('0.1.0') }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const { runUpdateCheckMock } = vi.hoisted(() => ({
  runUpdateCheckMock: vi.fn(),
}));

vi.mock('../../../services/update/updateService', () => ({
  runUpdateCheck: runUpdateCheckMock,
}));

import AboutTab from './AboutTab.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';
import {
  appUpdateState,
  destroyAppUpdateStore,
} from '../../../services/update/appUpdateStore.svelte';

function createMockHandler(): SettingsHandler {
  return {
    settings: {
      updates: { channel: 'stable', autoCheck: true },
    },
    updateChannel: vi.fn(),
    updateAutoCheck: vi.fn(),
    activeTab: 'about',
  } as unknown as SettingsHandler;
}

describe('AboutTab update restart button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destroyAppUpdateStore();
    invokeMock.mockResolvedValue(null);
  });

  it('shows Restart Now button after clicking Check for Updates when an update is installed', async () => {
    runUpdateCheckMock.mockResolvedValueOnce({ kind: 'installed', version: '0.2.0' });

    const handler = createMockHandler();
    render(AboutTab, { props: { handler } });

    // Initially no restart button
    expect(screen.queryByRole('button', { name: /restart now/i })).toBeNull();

    // Click Check for Updates button
    const checkBtn = screen.getByRole('button', { name: /check for updates/i });
    await fireEvent.click(checkBtn);

    // Expect Restart Now button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restart now/i })).toBeTruthy();
    });

    // Clicking Restart Now calls app_relaunch
    const restartBtn = screen.getByRole('button', { name: /restart now/i });
    await fireEvent.click(restartBtn);

    expect(invokeMock).toHaveBeenCalledWith('app_relaunch', undefined);
  });

  it('shows Restart Now button on mount if an update was already downloaded and is pending', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'app_updater_get_pending') {
        return { version: '0.2.0' };
      }
      return null;
    });

    const handler = createMockHandler();
    render(AboutTab, { props: { handler } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restart now/i })).toBeTruthy();
    });
  });

  it('does not show Restart Now button when up to date', async () => {
    runUpdateCheckMock.mockResolvedValueOnce({ kind: 'up-to-date' });

    const handler = createMockHandler();
    render(AboutTab, { props: { handler } });

    const checkBtn = screen.getByRole('button', { name: /check for updates/i });
    await fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText("You're running the latest version.")).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /restart now/i })).toBeNull();
  });

  it('does not show Restart Now button when update check fails', async () => {
    runUpdateCheckMock.mockResolvedValueOnce({ kind: 'error', message: 'network unreachable' });

    const handler = createMockHandler();
    render(AboutTab, { props: { handler } });

    const checkBtn = screen.getByRole('button', { name: /check for updates/i });
    await fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText(/Update check failed: network unreachable/i)).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /restart now/i })).toBeNull();
  });
});
