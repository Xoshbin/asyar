// asyar-launcher/src/lib/ipc/syncCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';

// ── Cloud Sync ────────────────────────────────────────────────────────────────

/**
 * One per-item entry handed to `sync_run`. The content field is already
 * JSON-stringified (Rust hashes it as bytes for delta detection) and
 * `isTombstone` flips true when the local state has the item marked for
 * deletion; the Rust orchestrator lifts that into a server-side delete.
 */
export interface LocalItemSourceWire {
  itemId: string;
  categoryId: string;
  content: string; // already JSON-stringified
  isTombstone?: boolean;
}

import type {
  AppliedRecord,
  E2eeStatusReport,
  IncomingPairingRequest,
  PairingApproveResult,
  PairingPollResult,
  PairingRequestResult,
  SyncPushFailure,
  SyncRunFailure,
  SyncRunReport,
} from '../../bindings';

export type {
  AppliedRecord,
  E2eeStatusReport,
  IncomingPairingRequest,
  PairingApproveResult,
  PairingPollResult,
  PairingRequestResult,
  SyncPushFailure,
  SyncRunFailure,
  SyncRunReport,
};

export type SyncE2eeStatusReport = E2eeStatusReport;

/**
 * Status DTO returned by sync_get_status. Cursor + device id + counts
 * for dirty/tombstone-pending items + last full-sync timestamp.
 */
export interface SyncStatusResponse {
  cursor: number;
  deviceId: string;
  lastFullSyncAtIso: string | null;
  dirtyCount: number;
  pendingTombstoneCount: number;
}

export async function syncRun(sources: LocalItemSourceWire[]): Promise<SyncRunReport> {
  return invokeSafe<SyncRunReport>('sync_run', { sources });
}

export async function syncGetStatus(): Promise<SyncStatusResponse> {
  return invokeSafe<SyncStatusResponse>('sync_get_status');
}

/**
 * Mark a journal entry as a tombstone so the next push uploads a deletion.
 *
 * Called when a provider's `subscribeToChanges` callback fires with
 * `type === 'delete'`. Without this, a local delete only removes the item
 * from the provider's store — the journal still records the item as live,
 * the orchestrator never emits a `PushTombstone` decision for it, and the
 * next pull resurrects the item from the server.
 */
export async function syncMarkTombstone(itemId: string, categoryId: string): Promise<void> {
  await invokeSafe<void>('sync_mark_tombstone', { itemId, categoryId });
}

/**
 * Reset local sync state (journal entries and cursor).
 * Used when recovering from corrupted sync state or when requesting a
 * full re-sync from the cloud.
 */
export async function syncReset(): Promise<void> {
  await invokeSafe<void>('sync_reset');
}

// ── E2EE cloud sync (Layer 4b/4c) ─────────────────────────────────────────────

export interface SyncE2eeEnrolmentResult {
  /** 24 BIP-39 words separated by single spaces. */
  recoveryPhrase: string;
}

/**
 * Get the current E2EE state. Cheap — reads local mirror + keychain only.
 * No HTTP. Suitable for polling on dialog mount.
 */
export async function syncE2eeGetStatus(): Promise<E2eeStatusReport> {
  return invokeSafe<E2eeStatusReport>('sync_e2ee_get_status');
}

/**
 * Enrol the user in encrypted sync. Generates a fresh master_seed,
 * derives the wrap_key from the passphrase, encrypts the seed, posts
 * to the server, caches the seed in the OS keychain, and returns the
 * 24-word recovery phrase. Throws on failure (network, validation,
 * already-enrolled).
 */
export async function syncE2eeEnrol(passphrase: string): Promise<SyncE2eeEnrolmentResult> {
  return invokeSafe<SyncE2eeEnrolmentResult>('sync_e2ee_enrol', { passphrase });
}

/**
 * Unlock the cached master_seed by trial-decrypting the local wrapped
 * seed with a passphrase-derived wrap_key. Wrong passphrase throws an
 * AppError::Validation — the service catches this and translates to
 * the `e2ee_passphrase_required` diagnostic kind.
 */
export async function syncE2eeUnlock(passphrase: string): Promise<boolean> {
  return invokeSafeVoid('sync_e2ee_unlock', { passphrase }, { silent: true });
}

/**
 * Unlock the device using a 24-word BIP-39 recovery phrase (device-key mode).
 */
export async function syncE2eeUnlockWithPhrase(phrase: string): Promise<boolean> {
  return invokeSafeVoid('sync_e2ee_unlock_with_phrase', { phrase }, { silent: true });
}

/**
 * Rotate the passphrase. Re-wraps the existing master_seed under a new
 * wrap_key. Server items are NOT re-encrypted (master_seed is
 * unchanged) — only one PUT to /api/sync/e2ee/state.
 */
export async function syncE2eeRotate(
  oldPassphrase: string,
  newPassphrase: string,
): Promise<boolean> {
  return invokeSafeVoid('sync_e2ee_rotate', { oldPassphrase, newPassphrase });
}

/**
 * Recover from a forgotten passphrase using the 24-word mnemonic.
 * Optionally pass a server-fetched ciphertext payload to verify
 * ownership before mutating server state — without this, a typed-but-
 * wrong-account mnemonic would silently lock the user out.
 */
export async function syncE2eeRecoverWithMnemonic(
  phrase: string,
  newPassphrase: string,
  verifyWithPayload?: string,
): Promise<boolean> {
  return invokeSafeVoid('sync_e2ee_recover_with_mnemonic', {
    phrase,
    newPassphrase,
    verifyWithPayload: verifyWithPayload ?? null,
  });
}

/**
 * Disable encrypted sync. Server DELETE → keychain delete → local
 * mirror clear. After this, the launcher reverts to plaintext sync;
 * existing items are re-uploaded as plaintext on the next mark-all-
 * dirty pass.
 */
export async function syncE2eeDisable(): Promise<boolean> {
  return invokeSafeVoid('sync_e2ee_disable');
}

/**
 * Re-display the 24-word recovery phrase. Requires the current
 * passphrase (verified by trial-decrypting the local wrapped seed)
 * to gate against shoulder-surfing on unlocked machines.
 */
export async function syncE2eeShowRecoveryPhrase(passphrase: string): Promise<string> {
  return invokeSafe<string>('sync_e2ee_show_recovery_phrase', { passphrase });
}

/**
 * Reveal the 24-word recovery phrase for device-key accounts without passphrase.
 */
export async function syncE2eeShowRecoveryPhraseDevice(): Promise<string> {
  return invokeSafe<string>('sync_e2ee_show_recovery_phrase_device');
}

/**
 * Request pairing from another device. Returns the pairing ID, 6-word fingerprint, and expiration.
 */
export async function syncE2eePairingRequest(deviceName: string): Promise<PairingRequestResult> {
  return invokeSafe<PairingRequestResult>('sync_e2ee_pairing_request', { deviceName });
}

/**
 * Poll pairing status from the new device.
 */
export async function syncE2eePairingPoll(id: string): Promise<PairingPollResult> {
  return invokeSafe<PairingPollResult>('sync_e2ee_pairing_poll', { id });
}

/**
 * Fetch incoming pairing requests on an existing approver device.
 */
export async function syncE2eePairingIncoming(): Promise<IncomingPairingRequest[]> {
  return invokeSafe<IncomingPairingRequest[]>('sync_e2ee_pairing_incoming');
}

/**
 * Approve an incoming pairing request, validating the displayed fingerprint words.
 */
export async function syncE2eePairingApprove(
  id: string,
  expectedFingerprint: string,
): Promise<PairingApproveResult> {
  return invokeSafe<PairingApproveResult>('sync_e2ee_pairing_approve', {
    id,
    expectedFingerprint,
  });
}

/**
 * Confirm pairing from the new device after SAS words comparison.
 */
export async function syncE2eePairingConfirm(id: string): Promise<void> {
  await invokeSafe<void>('sync_e2ee_pairing_confirm', { id });
}

/**
 * Reject pairing when SAS confirmation words mismatch.
 */
export async function syncE2eePairingReject(id: string): Promise<void> {
  await invokeSafe<void>('sync_e2ee_pairing_reject', { id });
}

/**
 * Cancel a pairing request (by requester or approver).
 */
export async function syncE2eePairingCancel(id: string): Promise<void> {
  await invokeSafe<void>('sync_e2ee_pairing_cancel', { id });
}

/**
 * Reset Cloud Sync: wipes server data, local mirror, and keychain seed, then re-enrols from local.
 */
export async function syncE2eeReset(): Promise<void> {
  await invokeSafe<void>('sync_e2ee_reset');
}
