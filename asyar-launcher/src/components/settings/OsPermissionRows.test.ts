// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { platformMock, checkMock, openPrefsMock } = vi.hoisted(() => ({
  platformMock: vi.fn(),
  checkMock: vi.fn(),
  openPrefsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-os', () => ({ platform: platformMock }));
vi.mock('../../lib/ipc/commands', () => ({
  checkSnippetPermission: checkMock,
  openAccessibilityPreferences: openPrefsMock,
}));

import OsPermissionRows from './OsPermissionRows.svelte';

describe('OsPermissionRows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing on non-macOS', async () => {
    platformMock.mockResolvedValue('linux');
    render(OsPermissionRows);
    await waitFor(() => expect(platformMock).toHaveBeenCalled());
    expect(screen.queryByText('Accessibility')).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('shows an open-settings action when Accessibility is not granted', async () => {
    platformMock.mockResolvedValue('macos');
    checkMock.mockResolvedValue(false);
    render(OsPermissionRows);

    expect(await screen.findByText('Accessibility')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /open system settings/i }));
    expect(openPrefsMock).toHaveBeenCalledOnce();
  });

  it('shows the granted state and re-checks on window focus', async () => {
    platformMock.mockResolvedValue('macos');
    checkMock.mockResolvedValue(false);
    render(OsPermissionRows);
    await screen.findByText('Accessibility');

    checkMock.mockResolvedValue(true);
    await fireEvent.focus(window);
    expect(await screen.findByText('Allowed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open system settings/i })).toBeNull();
  });
});
