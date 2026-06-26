import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  syncE2eeGetStatus: vi.fn(),
  syncE2eeEnrol: vi.fn(),
  syncE2eeUnlock: vi.fn(),
  syncE2eeRotate: vi.fn(),
  syncE2eeRecoverWithMnemonic: vi.fn(),
  syncE2eeDisable: vi.fn(),
  syncE2eeShowRecoveryPhrase: vi.fn(),
}));

vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as cmd from '../../lib/ipc/commands';
import { syncEncryptionService } from './syncEncryptionService.svelte';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';

describe('syncEncryptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('refreshStatus', () => {
    it('writes the backend response into reactive state', async () => {
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true, locked: false, keyVersion: 1,
      });
      await syncEncryptionService.refreshStatus();
      expect(syncEncryptionService.enabled).toBe(true);
      expect(syncEncryptionService.locked).toBe(false);
      expect(syncEncryptionService.keyVersion).toBe(1);
    });

    it('represents locked second-device state', async () => {
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: true, locked: true, keyVersion: 1,
      });
      await syncEncryptionService.refreshStatus();
      expect(syncEncryptionService.enabled).toBe(true);
      expect(syncEncryptionService.locked).toBe(true);
    });

    it('represents disabled state', async () => {
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: false, locked: false, keyVersion: null,
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
        enabled: true, locked: false, keyVersion: 1,
      });
      const phrase = await syncEncryptionService.enrol('correct horse battery staple');
      expect(phrase.split(' ')).toHaveLength(24);
      expect(cmd.syncE2eeEnrol).toHaveBeenCalledWith('correct horse battery staple');
      expect(cmd.syncE2eeGetStatus).toHaveBeenCalled();
    });

    it('emits e2ee_enrollment_failed on backend error and re-throws', async () => {
      vi.mocked(cmd.syncE2eeEnrol).mockResolvedValueOnce(null);
      await expect(
        syncEncryptionService.enrol('correct horse battery staple'),
      ).rejects.toThrow();
      expect(diagnosticsService.report).toHaveBeenCalledWith(
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
        enabled: true, locked: false, keyVersion: 1,
      });
      await syncEncryptionService.unlock('correct horse battery staple');
      expect(syncEncryptionService.locked).toBe(false);
    });

    it('emits e2ee_passphrase_required on incorrect passphrase and re-throws', async () => {
      vi.mocked(cmd.syncE2eeUnlock).mockResolvedValueOnce(false);
      await expect(syncEncryptionService.unlock('wrong')).rejects.toThrow();
      expect(diagnosticsService.report).toHaveBeenCalledWith(
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
        enabled: true, locked: false, keyVersion: 1,
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
        enabled: true, locked: false, keyVersion: 1,
      });
      await syncEncryptionService.recoverWithMnemonic(
        'twenty-four words here', 'new', 'enc:v1:abc',
      );
      expect(cmd.syncE2eeRecoverWithMnemonic).toHaveBeenCalledWith(
        'twenty-four words here', 'new', 'enc:v1:abc',
      );
    });
  });

  describe('disable', () => {
    it('refreshes status to disabled', async () => {
      vi.mocked(cmd.syncE2eeDisable).mockResolvedValueOnce(true);
      vi.mocked(cmd.syncE2eeGetStatus).mockResolvedValueOnce({
        enabled: false, locked: false, keyVersion: null,
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
});
