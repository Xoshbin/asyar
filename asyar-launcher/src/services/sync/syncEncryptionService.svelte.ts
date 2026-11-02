import {
  syncE2eeDisable,
  syncE2eeEnrol,
  syncE2eeGetStatus,
  syncE2eePairingApprove,
  syncE2eePairingCancel,
  syncE2eePairingConfirm,
  syncE2eePairingIncoming,
  syncE2eePairingPoll,
  syncE2eePairingReject,
  syncE2eePairingRequest,
  syncE2eeRecoverWithMnemonic,
  syncE2eeReset,
  syncE2eeRotate,
  syncE2eeShowRecoveryPhrase,
  syncE2eeShowRecoveryPhraseDevice,
  syncE2eeUnlock,
  syncE2eeUnlockWithPhrase,
} from '../../lib/ipc/commands';
import type {
  IncomingPairingRequest,
  PairingApproveResult,
  PairingPollResult,
  PairingRequestResult,
} from '../../lib/ipc/commands';
import { feedbackService } from '../feedback/feedbackService.svelte';
import { logService } from '../log/logService';

/**
 * High-level interface for end-to-end encrypted cloud sync. Wraps the
 * launcher-internal `sync_e2ee_*` Tauri commands and translates
 * backend errors into specific e2ee diagnostic kinds.
 *
 * This service is launcher-internal — not registered in
 * `buildServiceRegistry`, not exposed to Tier 2 extensions. The
 * passphrase never leaves the launcher process; this layer is purely
 * a thin coordinator between dialogs and the Rust service.
 */
export interface ISyncEncryptionService {
  /** Whether the user has an active e2ee enrolment on the server. */
  readonly enabled: boolean;
  /** Whether the user is enrolled but the master_seed is not cached
   * locally (second-device or post-clear-keychain). */
  readonly locked: boolean;
  /** Server-assigned key version, monotonic per user. `null` when not enrolled. */
  readonly keyVersion: number | null;
  /** Encryption mode: 'passphrase' | 'device-key' | null. */
  readonly mode: string | null;
  /** Whether the encryption key is held in the OS keychain (macOS/Windows/Linux secret-service) vs 0600 file fallback. */
  readonly keystoreIsOsBacked: boolean;
  /** Whether finalize needs to run on next pull. */
  readonly finalizePending: boolean;
  /** Incoming pairing requests on approver device. */
  readonly incomingPairings: IncomingPairingRequest[];

  refreshStatus(): Promise<void>;
  enrol(passphrase: string): Promise<string>;
  unlock(passphrase: string): Promise<void>;
  unlockWithPhrase(phrase: string): Promise<void>;
  rotate(oldPassphrase: string, newPassphrase: string): Promise<void>;
  recoverWithMnemonic(
    phrase: string,
    newPassphrase: string,
    verifyWithPayload?: string,
  ): Promise<void>;
  disable(): Promise<void>;
  showRecoveryPhrase(passphrase: string): Promise<string>;
  showRecoveryPhraseDevice(): Promise<string>;
  requestPairing(deviceName: string): Promise<PairingRequestResult>;
  pollPairing(id: string): Promise<PairingPollResult>;
  confirmPairing(id: string): Promise<void>;
  rejectPairing(id: string): Promise<void>;
  cancelPairing(id: string): Promise<void>;
  checkIncomingPairings(): Promise<IncomingPairingRequest[]>;
  approvePairing(id: string, expectedFingerprint: string): Promise<PairingApproveResult>;
  reset(): Promise<void>;
}

export class SyncEncryptionService implements ISyncEncryptionService {
  enabled = $state(false);
  locked = $state(false);
  keyVersion = $state<number | null>(null);
  mode = $state<string | null>(null);
  keystoreIsOsBacked = $state(true);
  finalizePending = $state(false);
  incomingPairings = $state<IncomingPairingRequest[]>([]);

  async refreshStatus(): Promise<void> {
    const s = await syncE2eeGetStatus();
    this.enabled = s.enabled;
    this.locked = s.locked;
    this.keyVersion = s.keyVersion;
    this.mode = s.mode ?? null;
    this.keystoreIsOsBacked = s.keystoreIsOsBacked ?? true;
    this.finalizePending = s.finalizePending ?? false;
  }

  // ── Error translation policy ────────────────────────────────────────────────
  //
  // Only `enrol` and `unlock` translate raw backend errors into specific
  // e2ee diagnostic kinds (`e2ee_enrollment_failed`, `e2ee_passphrase_required`).
  // The other methods (rotate, recoverWithMnemonic, disable, showRecoveryPhrase)
  // propagate raw errors to the calling dialog, which owns the user-facing
  // wording for context-specific failures.
  //
  // If Phase 8 dialogs end up duplicating "catch + classify + report" logic,
  // move that classification down here rather than fragmenting it across
  // dialog components.
  async enrol(passphrase: string): Promise<string> {
    try {
      const result = await syncE2eeEnrol(passphrase);
      await this.refreshStatus();
      return result.recoveryPhrase;
    } catch (err) {
      logService.warn(`e2ee enrol failed: ${String(err)}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'e2ee_enrollment_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
      throw err;
    }
  }

  async unlock(passphrase: string): Promise<void> {
    const ok = await syncE2eeUnlock(passphrase);
    if (!ok) {
      const err = new Error('Incorrect passphrase or unlock failed');
      logService.warn(`e2ee unlock failed: ${String(err)}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'e2ee_passphrase_required',
        severity: 'warning',
        retryable: true,
        developerDetail: String(err),
      });
      throw err;
    }
    await this.refreshStatus();
  }

  async rotate(oldPassphrase: string, newPassphrase: string): Promise<void> {
    const ok = await syncE2eeRotate(oldPassphrase, newPassphrase);
    if (!ok) {
      throw new Error('sync_e2ee_rotate failed');
    }
    await this.refreshStatus();
  }

  async recoverWithMnemonic(
    phrase: string,
    newPassphrase: string,
    verifyWithPayload?: string,
  ): Promise<void> {
    const ok = await syncE2eeRecoverWithMnemonic(phrase, newPassphrase, verifyWithPayload);
    if (!ok) {
      throw new Error('sync_e2ee_recover_with_mnemonic failed');
    }
    await this.refreshStatus();
  }

  async disable(): Promise<void> {
    const ok = await syncE2eeDisable();
    if (!ok) {
      throw new Error('sync_e2ee_disable failed');
    }
    await this.refreshStatus();
  }

  async showRecoveryPhrase(passphrase: string): Promise<string> {
    return syncE2eeShowRecoveryPhrase(passphrase);
  }

  async unlockWithPhrase(phrase: string): Promise<void> {
    const ok = await syncE2eeUnlockWithPhrase(phrase);
    if (!ok) {
      throw new Error('Incorrect recovery phrase or unlock failed');
    }
    await this.refreshStatus();
  }

  async showRecoveryPhraseDevice(): Promise<string> {
    return syncE2eeShowRecoveryPhraseDevice();
  }

  async requestPairing(deviceName: string): Promise<PairingRequestResult> {
    return syncE2eePairingRequest(deviceName);
  }

  async pollPairing(id: string): Promise<PairingPollResult> {
    return syncE2eePairingPoll(id);
  }

  async confirmPairing(id: string): Promise<void> {
    await syncE2eePairingConfirm(id);
    await this.refreshStatus();
  }

  async rejectPairing(id: string): Promise<void> {
    await syncE2eePairingReject(id);
  }

  async cancelPairing(id: string): Promise<void> {
    await syncE2eePairingCancel(id);
  }

  async checkIncomingPairings(): Promise<IncomingPairingRequest[]> {
    const requests = await syncE2eePairingIncoming();
    this.incomingPairings = requests;
    return requests;
  }

  async approvePairing(id: string, expectedFingerprint: string): Promise<PairingApproveResult> {
    const result = await syncE2eePairingApprove(id, expectedFingerprint);
    this.incomingPairings = this.incomingPairings.filter((req) => req.id !== id);
    return result;
  }

  async reset(): Promise<void> {
    await syncE2eeReset();
    await this.refreshStatus();
  }
}

export const syncEncryptionService = new SyncEncryptionService();
