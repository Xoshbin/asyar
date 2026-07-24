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

export interface SyncRunFailure {
  itemId: string;
  reason: string;
}

/**
 * One server-applied record from a pull pass. The TS sync service fans
 * these out through `provider.applyItemUpsert` (live rows) or
 * `provider.applyItemDelete` (tombstones, where `deleted=true` and
 * `content` is `null`).
 */
export interface AppliedRecord {
  itemId: string;
  categoryId: string;
  content: string | null;
  deleted: boolean;
}

export interface SyncRunReport {
  uploaded: string[];
  skipped: string[];
  failed: SyncRunFailure[];
  /** Cheap id-only mirror of `appliedRecords`, kept for diagnostic counts. */
  appliedFromPull: string[];
  /** Full applied records — drives provider.applyItemUpsert / applyItemDelete. */
  appliedRecords: AppliedRecord[];
  lwwWarnings: string[];
  serverVersion: number;
}

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

export async function syncRun(sources: LocalItemSourceWire[]): Promise<SyncRunReport | null> {
  return invokeSafe<SyncRunReport>('sync_run', { sources });
}

export async function syncGetStatus(): Promise<SyncStatusResponse | null> {
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

// ── E2EE cloud sync (Layer 4b/4c) ─────────────────────────────────────────────

export interface SyncE2eeStatusReport {
  enabled: boolean;
  locked: boolean;
  keyVersion: number | null;
}

export interface SyncE2eeEnrolmentResult {
  /** 24 BIP-39 words separated by single spaces. */
  recoveryPhrase: string;
}

/**
 * Get the current E2EE state. Cheap — reads local mirror + keychain only.
 * No HTTP. Suitable for polling on dialog mount.
 */
export async function syncE2eeGetStatus(): Promise<SyncE2eeStatusReport | null> {
  return invokeSafe<SyncE2eeStatusReport>('sync_e2ee_get_status');
}

/**
 * Enrol the user in encrypted sync. Generates a fresh master_seed,
 * derives the wrap_key from the passphrase, encrypts the seed, posts
 * to the server, caches the seed in the OS keychain, and returns the
 * 24-word recovery phrase. Throws on failure (network, validation,
 * already-enrolled).
 */
export async function syncE2eeEnrol(passphrase: string): Promise<SyncE2eeEnrolmentResult | null> {
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
export async function syncE2eeShowRecoveryPhrase(passphrase: string): Promise<string | null> {
  return invokeSafe<string>('sync_e2ee_show_recovery_phrase', { passphrase });
}
