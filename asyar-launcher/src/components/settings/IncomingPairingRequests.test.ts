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

vi.mock('../../services/sync/syncEncryptionService.svelte', () => {
  let incomingPairings: any[] = [];
  return {
    syncEncryptionService: {
      get incomingPairings() {
        return incomingPairings;
      },
      set incomingPairings(v: any[]) {
        incomingPairings = v;
      },
      checkIncomingPairings: vi.fn().mockResolvedValue([]),
      approvePairing: vi.fn(),
      cancelPairing: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import IncomingPairingRequests from './IncomingPairingRequests.svelte';
import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';

describe('IncomingPairingRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncEncryptionService.incomingPairings = [];
  });

  it('renders check button and triggers checkIncomingPairings on click', async () => {
    render(IncomingPairingRequests);

    const checkBtn = screen.getByRole('button', { name: 'Check for requests' });
    await fireEvent.click(checkBtn);

    expect(syncEncryptionService.checkIncomingPairings).toHaveBeenCalledTimes(1);
  });

  it('renders incoming requests list with device name and fingerprint words', () => {
    syncEncryptionService.incomingPairings = [
      {
        id: 'req-456',
        deviceName: 'MacBook Air',
        devicePublicKey: 'pub-key',
        fingerprint: 'word1 word2 word3 word4 word5 word6',
        createdAt: '2026-11-01T20:00:00Z',
        expiresAt: '2026-11-01T20:10:00Z',
      },
    ];

    render(IncomingPairingRequests);

    expect(screen.getByText('Device: MacBook Air')).toBeTruthy();
    expect(screen.getByText('word1')).toBeTruthy();
    expect(screen.getByText('word6')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });

  it('approves request and renders confirmation words', async () => {
    syncEncryptionService.incomingPairings = [
      {
        id: 'req-456',
        deviceName: 'MacBook Air',
        devicePublicKey: 'pub-key',
        fingerprint: 'word1 word2 word3 word4 word5 word6',
        createdAt: '2026-11-01T20:00:00Z',
        expiresAt: '2026-11-01T20:10:00Z',
      },
    ];

    vi.mocked(syncEncryptionService.approvePairing).mockResolvedValueOnce({
      confirmationWords: 'conf1 conf2 conf3 conf4 conf5 conf6',
    });

    render(IncomingPairingRequests);

    const approveBtn = screen.getByRole('button', { name: 'Approve' });
    await fireEvent.click(approveBtn);

    expect(syncEncryptionService.approvePairing).toHaveBeenCalledWith(
      'req-456',
      'word1 word2 word3 word4 word5 word6',
    );

    await waitFor(() => {
      expect(screen.getByText('Device approved')).toBeTruthy();
      expect(screen.getByText('conf1')).toBeTruthy();
      expect(screen.getByText('conf6')).toBeTruthy();
    });
  });

  it('displays security warning on fingerprint mismatch', async () => {
    syncEncryptionService.incomingPairings = [
      {
        id: 'req-456',
        deviceName: 'MacBook Air',
        devicePublicKey: 'pub-key',
        fingerprint: 'word1 word2 word3 word4 word5 word6',
        createdAt: '2026-11-01T20:00:00Z',
        expiresAt: '2026-11-01T20:10:00Z',
      },
    ];

    const mismatchErr = new Error('sync_pairing_fingerprint_mismatch');
    vi.mocked(syncEncryptionService.approvePairing).mockRejectedValueOnce(mismatchErr);

    render(IncomingPairingRequests);

    const approveBtn = screen.getByRole('button', { name: 'Approve' });
    await fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Security warning: Security fingerprint mismatch. Approval was blocked to protect your data.',
        ),
      ).toBeTruthy();
    });
  });

  it('denies request and cancels pairing', async () => {
    syncEncryptionService.incomingPairings = [
      {
        id: 'req-456',
        deviceName: 'MacBook Air',
        devicePublicKey: 'pub-key',
        fingerprint: 'word1 word2 word3 word4 word5 word6',
        createdAt: '2026-11-01T20:00:00Z',
        expiresAt: '2026-11-01T20:10:00Z',
      },
    ];

    render(IncomingPairingRequests);

    const denyBtn = screen.getByRole('button', { name: 'Deny' });
    await fireEvent.click(denyBtn);

    expect(syncEncryptionService.cancelPairing).toHaveBeenCalledWith('req-456');
  });
});
