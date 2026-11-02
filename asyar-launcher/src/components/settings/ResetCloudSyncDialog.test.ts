// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  transformCallback: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/sync/syncEncryptionService.svelte', () => ({
  syncEncryptionService: {
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/sync/cloudSyncService.svelte', () => ({
  cloudSyncService: {
    syncNow: vi.fn().mockResolvedValue(undefined),
  },
}));

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

import ResetCloudSyncDialog from './ResetCloudSyncDialog.svelte';
import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';

describe('ResetCloudSyncDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title, body explanation, and action buttons', () => {
    render(ResetCloudSyncDialog, { props: { isOpen: true } });

    expect(screen.getByRole('heading', { name: 'Reset Cloud Sync' })).toBeTruthy();
    expect(
      screen.getByText(
        /This will delete all your synced data from the Asyar server and re-upload this device's data with a fresh encryption key/i,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset Cloud Sync' })).toBeTruthy();
  });

  it('calls reset and syncNow on confirmation click', async () => {
    const onComplete = vi.fn();
    render(ResetCloudSyncDialog, { props: { isOpen: true, onComplete } });

    const resetBtn = screen.getByRole('button', { name: 'Reset Cloud Sync' });
    await fireEvent.click(resetBtn);

    expect(syncEncryptionService.reset).toHaveBeenCalledTimes(1);
    expect(cloudSyncService.syncNow).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    render(ResetCloudSyncDialog, { props: { isOpen: true, onCancel } });

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await fireEvent.click(cancelBtn);

    expect(syncEncryptionService.reset).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
