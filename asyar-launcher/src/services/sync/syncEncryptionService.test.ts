import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  syncE2eeGetStatus: vi.fn(),
  syncE2eeEnrol: vi.fn(),
  syncE2eeUnlock: vi.fn(),
  syncE2eeUnlockWithPhrase: vi.fn(),
  syncE2eeRotate: vi.fn(),
  syncE2eeRecoverWithMnemonic: vi.fn(),
  syncE2eeDisable: vi.fn(),
  syncE2eeShowRecoveryPhrase: vi.fn(),
  syncE2eeShowRecoveryPhraseDevice: vi.fn(),
  syncE2eePairingRequest: vi.fn(),
  syncE2eePairingPoll: vi.fn(),
  syncE2eePairingIncoming: vi.fn(),
  syncE2eePairingApprove: vi.fn(),
  syncE2eePairingConfirm: vi.fn(),
  syncE2eePairingReject: vi.fn(),
  syncE2eePairingCancel: vi.fn(),
  syncE2eeReset: vi.fn(),
}));

vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as cmd from '../../lib/ipc/commands';
import { syncEncryptionService } from './syncEncryptionService.svelte';
import { feedbackService } from '../feedback/feedbackService.svelte';

describe('syncEncryptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('refreshStatus', () => {
    it('writes the backend response into reactive state', async () => {
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'passphrase',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.refreshStatus();
      expect(syncEncryptionService.enabled).toBe(true);
      expect(syncEncryptionService.locked).toBe(false);
      expect(syncEncryptionService.keyVersion).toBe(1);
    });

    it('represents locked second-device state', async () => {
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: true,
        keyVersion: 1,
        mode: 'passphrase',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.refreshStatus();
      expect(syncEncryptionService.enabled).toBe(true);
      expect(syncEncryptionService.locked).toBe(true);
    });

    it('represents disabled state', async () => {
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: false,
        locked: false,
        keyVersion: null,
        mode: null,
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.refreshStatus();
      expect(syncEncryptionService.enabled).toBe(false);
      expect(syncEncryptionService.keyVersion).toBeNull();
    });
  });

  describe('enrol', () => {
    it('returns the recovery phrase and refreshes status', async () => {
      vi.mocked(cmd.syncE2eeEnrol).mockResolvedValueOnce({
        recoveryPhrase: 'a b c d e f g h i j k l m n o p q r s t u v w x',
      });
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'passphrase',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      const phrase = await syncEncryptionService.enrol('correct horse battery staple');
      expect(phrase.split(' ')).toHaveLength(24);
      expect(cmd.syncE2eeEnrol).toHaveBeenCalledWith('correct horse battery staple');
      expect(cmd.syncE2eeGetStatus).toHaveBeenCalled();
    });

    it('emits e2ee_enrollment_failed on backend error and re-throws', async () => {
      vi.mocked(cmd.syncE2eeEnrol).mockRejectedValueOnce(new Error('enrol failed'));
      await expect(syncEncryptionService.enrol('correct horse battery staple')).rejects.toThrow();
      expect(feedbackService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'e2ee_enrollment_failed',
          severity: 'error',
          retryable: false,
        }),
      );
    });
  });

  describe('unlock', () => {
    it('refreshes status on success', async () => {
      vi.mocked(cmd.syncE2eeUnlock).mockResolvedValueOnce(true);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'passphrase',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.unlock('correct horse battery staple');
      expect(syncEncryptionService.locked).toBe(false);
    });

    it('emits e2ee_passphrase_required on incorrect passphrase and re-throws', async () => {
      vi.mocked(cmd.syncE2eeUnlock).mockResolvedValueOnce(false);
      await expect(syncEncryptionService.unlock('wrong')).rejects.toThrow();
      expect(feedbackService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'e2ee_passphrase_required',
          severity: 'warning',
          retryable: true,
        }),
      );
    });
  });

  describe('rotate', () => {
    it('refreshes status after success', async () => {
      vi.mocked(cmd.syncE2eeRotate).mockResolvedValueOnce(true);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'passphrase',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.rotate('old-passphrase', 'new-passphrase');
      expect(cmd.syncE2eeRotate).toHaveBeenCalledWith('old-passphrase', 'new-passphrase');
      expect(cmd.syncE2eeGetStatus).toHaveBeenCalled();
    });
  });

  describe('recoverWithMnemonic', () => {
    it('passes verifyWithPayload through and refreshes', async () => {
      vi.mocked(cmd.syncE2eeRecoverWithMnemonic).mockResolvedValueOnce(true);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'passphrase',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.recoverWithMnemonic(
        'twenty-four words here',
        'new',
        'enc:v1:abc',
      );
      expect(cmd.syncE2eeRecoverWithMnemonic).toHaveBeenCalledWith(
        'twenty-four words here',
        'new',
        'enc:v1:abc',
      );
    });
  });

  describe('disable', () => {
    it('refreshes status to disabled', async () => {
      vi.mocked(cmd.syncE2eeDisable).mockResolvedValueOnce(true);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: false,
        locked: false,
        keyVersion: null,
        mode: null,
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.disable();
      expect(syncEncryptionService.enabled).toBe(false);
    });
  });

  describe('showRecoveryPhrase', () => {
    it('returns the phrase from the backend', async () => {
      vi.mocked(cmd.syncE2eeShowRecoveryPhrase).mockResolvedValueOnce(
        'a b c d e f g h i j k l m n o p q r s t u v w x',
      );
      const phrase = await syncEncryptionService.showRecoveryPhrase('passphrase');
      expect(phrase.split(' ')).toHaveLength(24);
    });
  });

  describe('device-key methods', () => {
    it('unlockWithPhrase calls backend and refreshes status', async () => {
      vi.mocked(cmd.syncE2eeUnlockWithPhrase).mockResolvedValueOnce(true);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'device-key',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });

      await syncEncryptionService.unlockWithPhrase('twenty four words');
      expect(cmd.syncE2eeUnlockWithPhrase).toHaveBeenCalledWith('twenty four words');
      expect(syncEncryptionService.locked).toBe(false);
      expect(syncEncryptionService.mode).toBe('device-key');
    });

    it('unlockWithPhrase throws if backend returns false', async () => {
      vi.mocked(cmd.syncE2eeUnlockWithPhrase).mockResolvedValueOnce(false);
      await expect(syncEncryptionService.unlockWithPhrase('wrong words')).rejects.toThrow(
        'Incorrect recovery phrase or unlock failed',
      );
    });

    it('showRecoveryPhraseDevice returns 24 words without passphrase', async () => {
      vi.mocked(cmd.syncE2eeShowRecoveryPhraseDevice).mockResolvedValueOnce(
        'alpha beta gamma delta',
      );
      const phrase = await syncEncryptionService.showRecoveryPhraseDevice();
      expect(phrase).toBe('alpha beta gamma delta');
      expect(cmd.syncE2eeShowRecoveryPhraseDevice).toHaveBeenCalled();
    });

    it('requestPairing calls backend with device name', async () => {
      vi.mocked(cmd.syncE2eePairingRequest).mockResolvedValueOnce({
        id: 'req-1',
        fingerprint: 'word1 word2 word3 word4 word5 word6',
        expiresAt: '2026-11-01T23:59:59Z',
      });
      const res = await syncEncryptionService.requestPairing('My Laptop');
      expect(res.id).toBe('req-1');
      expect(res.fingerprint).toBe('word1 word2 word3 word4 word5 word6');
      expect(cmd.syncE2eePairingRequest).toHaveBeenCalledWith('My Laptop');
    });

    it('pollPairing calls backend with pairing id', async () => {
      vi.mocked(cmd.syncE2eePairingPoll).mockResolvedValueOnce({
        status: 'awaiting-confirmation',
        confirmationWords: 'conf1 conf2 conf3 conf4 conf5 conf6',
      });
      const res = await syncEncryptionService.pollPairing('req-1');
      expect(res.status).toBe('awaiting-confirmation');
      expect(res.confirmationWords).toBe('conf1 conf2 conf3 conf4 conf5 conf6');
      expect(cmd.syncE2eePairingPoll).toHaveBeenCalledWith('req-1');
    });

    it('confirmPairing calls backend and refreshes status', async () => {
      vi.mocked(cmd.syncE2eePairingConfirm).mockResolvedValueOnce(undefined);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'device-key',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.confirmPairing('req-1');
      expect(cmd.syncE2eePairingConfirm).toHaveBeenCalledWith('req-1');
      expect(syncEncryptionService.locked).toBe(false);
    });

    it('rejectPairing calls backend', async () => {
      vi.mocked(cmd.syncE2eePairingReject).mockResolvedValueOnce(undefined);
      await syncEncryptionService.rejectPairing('req-1');
      expect(cmd.syncE2eePairingReject).toHaveBeenCalledWith('req-1');
    });

    it('cancelPairing calls backend', async () => {
      vi.mocked(cmd.syncE2eePairingCancel).mockResolvedValueOnce(undefined);
      await syncEncryptionService.cancelPairing('req-1');
      expect(cmd.syncE2eePairingCancel).toHaveBeenCalledWith('req-1');
    });

    it('checkIncomingPairings fetches requests and stores in incomingPairings', async () => {
      const mockReqs = [
        {
          id: 'p1',
          deviceName: 'Phone',
          devicePublicKey: 'pub1',
          fingerprint: 'f1 f2 f3 f4 f5 f6',
          createdAt: '2026-11-01T23:00:00Z',
          expiresAt: '2026-11-01T23:10:00Z',
        },
      ];
      vi.mocked(cmd.syncE2eePairingIncoming).mockResolvedValueOnce(mockReqs);
      const result = await syncEncryptionService.checkIncomingPairings();
      expect(result).toEqual(mockReqs);
      expect(syncEncryptionService.incomingPairings).toEqual(mockReqs);
    });

    it('approvePairing calls backend and filters out approved pairing', async () => {
      syncEncryptionService.incomingPairings = [
        {
          id: 'p1',
          deviceName: 'Phone',
          devicePublicKey: 'pub1',
          fingerprint: 'f1 f2 f3 f4 f5 f6',
          createdAt: '2026-11-01T23:00:00Z',
          expiresAt: '2026-11-01T23:10:00Z',
        },
      ];
      vi.mocked(cmd.syncE2eePairingApprove).mockResolvedValueOnce({
        confirmationWords: 'c1 c2 c3 c4 c5 c6',
      });
      const res = await syncEncryptionService.approvePairing('p1', 'f1 f2 f3 f4 f5 f6');
      expect(res.confirmationWords).toBe('c1 c2 c3 c4 c5 c6');
      expect(cmd.syncE2eePairingApprove).toHaveBeenCalledWith('p1', 'f1 f2 f3 f4 f5 f6');
      expect(syncEncryptionService.incomingPairings).toEqual([]);
    });

    it('reset calls backend and refreshes status', async () => {
      vi.mocked(cmd.syncE2eeReset).mockResolvedValueOnce(undefined);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true,
        locked: false,
        keyVersion: 1,
        mode: 'device-key',
        keystoreIsOsBacked: true,
        finalizePending: false,
      });
      await syncEncryptionService.reset();
      expect(cmd.syncE2eeReset).toHaveBeenCalled();
      expect(cmd.syncE2eeGetStatus).toHaveBeenCalled();
    });
  });
});
