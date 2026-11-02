// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

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
    unlockWithPhrase: vi.fn(),
    requestPairing: vi.fn(),
    pollPairing: vi.fn(),
    confirmPairing: vi.fn(),
    rejectPairing: vi.fn().mockResolvedValue(undefined),
    cancelPairing: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/sync/cloudSyncService.svelte', () => ({
  cloudSyncService: {
    syncNow: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/device/deviceName', () => ({
  getDeviceName: vi.fn().mockResolvedValue('Test Machine'),
}));

import DeviceKeyLockedCard from './DeviceKeyLockedCard.svelte';
import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';
import { cloudSyncService } from '../../services/sync/cloudSyncService.svelte';

const valid24Words =
  'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual';

describe('DeviceKeyLockedCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title, tabs, and escape hatch', () => {
    render(DeviceKeyLockedCard);

    expect(screen.getByText("This device can't read your synced data yet")).toBeTruthy();
    expect(screen.getByText('Enter recovery phrase')).toBeTruthy();
    expect(screen.getByText('Approve from another device')).toBeTruthy();
    expect(screen.getByText('I have no phrase and no other device')).toBeTruthy();
  });

  it('triggers onResetClick when escape hatch is clicked', async () => {
    const onResetClick = vi.fn();
    render(DeviceKeyLockedCard, { props: { onResetClick } });

    const escapeLink = screen.getByText('I have no phrase and no other device');
    await fireEvent.click(escapeLink);

    expect(onResetClick).toHaveBeenCalledTimes(1);
  });

  it('phrase flow: unlocks and triggers syncNow on valid 24 words', async () => {
    vi.mocked(syncEncryptionService.unlockWithPhrase).mockResolvedValueOnce(undefined);

    render(DeviceKeyLockedCard);

    const textarea = screen.getByPlaceholderText('Paste your 24-word recovery phrase here...');
    await fireEvent.input(textarea, { target: { value: valid24Words } });

    expect(screen.getByText('24 / 24 words')).toBeTruthy();

    const unlockBtn = screen.getByRole('button', { name: 'Unlock' });
    expect(unlockBtn.hasAttribute('disabled')).toBe(false);

    await fireEvent.click(unlockBtn);

    expect(syncEncryptionService.unlockWithPhrase).toHaveBeenCalledWith(valid24Words);
    expect(cloudSyncService.syncNow).toHaveBeenCalledTimes(1);
  });

  it('phrase flow: displays error banner when unlock fails', async () => {
    vi.mocked(syncEncryptionService.unlockWithPhrase).mockRejectedValueOnce(new Error('fail'));

    render(DeviceKeyLockedCard);

    const textarea = screen.getByPlaceholderText('Paste your 24-word recovery phrase here...');
    await fireEvent.input(textarea, { target: { value: valid24Words } });

    const unlockBtn = screen.getByRole('button', { name: 'Unlock' });
    await fireEvent.click(unlockBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Incorrect recovery phrase. Please check the words and try again.'),
      ).toBeTruthy();
    });
  });

  it('phrase flow: a failed sync after a successful unlock is not reported as a bad phrase', async () => {
    vi.mocked(syncEncryptionService.unlockWithPhrase).mockResolvedValueOnce(undefined);
    vi.mocked(cloudSyncService.syncNow).mockRejectedValueOnce(new Error('offline'));

    render(DeviceKeyLockedCard);

    const textarea = screen.getByPlaceholderText('Paste your 24-word recovery phrase here...');
    await fireEvent.input(textarea, { target: { value: valid24Words } });
    await fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(cloudSyncService.syncNow).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('Incorrect recovery phrase. Please check the words and try again.'),
    ).toBeNull();
  });

  it('pairing flow: requests pairing and shows 6 fingerprint words', async () => {
    vi.mocked(syncEncryptionService.requestPairing).mockResolvedValueOnce({
      id: 'pair-123',
      fingerprint: 'apple banana cherry date elder fig',
      expiresAt: '2026-11-01T23:59:59Z',
    });
    vi.mocked(syncEncryptionService.pollPairing).mockResolvedValue({
      status: 'pending',
      confirmationWords: null,
    });

    render(DeviceKeyLockedCard);

    const pairTab = screen.getByText('Approve from another device');
    await fireEvent.click(pairTab);

    await waitFor(() => {
      expect(syncEncryptionService.requestPairing).toHaveBeenCalledWith('Test Machine');
      expect(screen.getByText('apple')).toBeTruthy();
      expect(screen.getByText('elder')).toBeTruthy();
      expect(screen.getByText('fig')).toBeTruthy();
    });
  });

  it('pairing flow: handles awaiting-confirmation and confirm action', async () => {
    vi.mocked(syncEncryptionService.requestPairing).mockResolvedValueOnce({
      id: 'pair-123',
      fingerprint: 'apple banana cherry date elder fig',
      expiresAt: '2026-11-01T23:59:59Z',
    });
    vi.mocked(syncEncryptionService.pollPairing).mockResolvedValueOnce({
      status: 'awaiting-confirmation',
      confirmationWords: 'grape hazelnut kiwi lemon mango nut',
    });
    vi.mocked(syncEncryptionService.confirmPairing).mockResolvedValueOnce(undefined);

    vi.useFakeTimers();

    render(DeviceKeyLockedCard);

    const pairTab = screen.getByText('Approve from another device');
    await fireEvent.click(pairTab);

    // Let requestPairing settle
    await vi.advanceTimersByTimeAsync(0);

    // Advance 3s for poll timer
    await vi.advanceTimersByTimeAsync(3000);

    expect(screen.getByText('grape')).toBeTruthy();
    expect(screen.getByText('mango')).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: 'Confirm & Sync' });
    await fireEvent.click(confirmBtn);

    expect(syncEncryptionService.confirmPairing).toHaveBeenCalledWith('pair-123');
    expect(cloudSyncService.syncNow).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('pairing flow: handles mismatch rejection and shows security warning', async () => {
    vi.mocked(syncEncryptionService.requestPairing).mockResolvedValueOnce({
      id: 'pair-123',
      fingerprint: 'apple banana cherry date elder fig',
      expiresAt: '2026-11-01T23:59:59Z',
    });
    vi.mocked(syncEncryptionService.pollPairing).mockResolvedValueOnce({
      status: 'awaiting-confirmation',
      confirmationWords: 'grape hazelnut kiwi lemon mango nut',
    });
    vi.mocked(syncEncryptionService.rejectPairing).mockResolvedValueOnce(undefined);

    vi.useFakeTimers();

    render(DeviceKeyLockedCard);

    const pairTab = screen.getByText('Approve from another device');
    await fireEvent.click(pairTab);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);

    const mismatchBtn = screen.getByRole('button', { name: "They don't match" });
    await fireEvent.click(mismatchBtn);

    expect(syncEncryptionService.rejectPairing).toHaveBeenCalledWith('pair-123');
    expect(
      screen.getByText(
        'Security warning: Words did not match. Pairing was rejected to protect your data.',
      ),
    ).toBeTruthy();

    vi.useRealTimers();
  });
});
