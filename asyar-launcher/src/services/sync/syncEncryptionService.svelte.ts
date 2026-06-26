import {
  syncE2eeDisable,
  syncE2eeEnrol,
  syncE2eeGetStatus,
  syncE2eeRecoverWithMnemonic,
  syncE2eeRotate,
  syncE2eeShowRecoveryPhrase,
  syncE2eeUnlock,
} from '../../lib/ipc/commands';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';
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

  refreshStatus(): Promise<void>;
  enrol(passphrase: string): Promise<string>;
  unlock(passphrase: string): Promise<void>;
  rotate(oldPassphrase: string, newPassphrase: string): Promise<void>;
  recoverWithMnemonic(
    phrase: string,
    newPassphrase: string,
    verifyWithPayload?: string,
  ): Promise<void>;
  disable(): Promise<void>;
  showRecoveryPhrase(passphrase: string): Promise<string>;
}

export class SyncEncryptionService implements ISyncEncryptionService {
  enabled = $state(false);
  locked = $state(false);
  keyVersion = $state<number | null>(null);

  async refreshStatus(): Promise<void> {
    const s = await syncE2eeGetStatus();
    if (s === null) {
      throw new Error('sync_e2ee_get_status failed');
    }
    this.enabled = s.enabled;
    this.locked = s.locked;
    this.keyVersion = s.keyVersion;
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
    const result = await syncE2eeEnrol(passphrase);
    if (result === null) {
      const err = new Error('sync_e2ee_enrol failed');
      logService.warn(`e2ee enrol failed: ${String(err)}`);
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'e2ee_enrollment_failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      });
      throw err;
    }
    await this.refreshStatus();
    return result.recoveryPhrase;
  }

  async unlock(passphrase: string): Promise<void> {
    const ok = await syncE2eeUnlock(passphrase);
    if (!ok) {
      const err = new Error('Incorrect passphrase or unlock failed');
      logService.warn(`e2ee unlock failed: ${String(err)}`);
      await diagnosticsService.report({
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
    const result = await syncE2eeShowRecoveryPhrase(passphrase);
    if (result === null) {
      throw new Error('sync_e2ee_show_recovery_phrase failed');
    }
    return result;
  }
}

export const syncEncryptionService = new SyncEncryptionService();
