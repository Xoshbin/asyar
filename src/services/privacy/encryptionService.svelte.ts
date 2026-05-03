import {
  cryptoGetStatus,
  cryptoEncrypt,
  cryptoDecrypt,
  type EncryptionStatusPayload,
} from '../../lib/ipc/commands';

/**
 * UI-facing status of the at-rest encryption layer.
 *
 * - `active` — the master key is in the OS keychain; full protection
 *   against disk-image theft.
 * - `fallback` — Linux Secret Service was unavailable; the key sits in
 *   a `0600` file alongside the database. Equivalent to the prior
 *   defense-in-depth strength; the privacy UI should surface this.
 * - `unknown` — the host status command failed (e.g. the launcher is
 *   still booting). Treat as "no information" and try again later.
 */
export type EncryptionStatus =
  | { status: 'active'; isOsBacked: true }
  | { status: 'fallback'; isOsBacked: false }
  | { status: 'unknown' };

/**
 * Reactive wrapper around the host-side Layer 3 encryption layer.
 * The master key never crosses the IPC boundary — `encrypt`/`decrypt`
 * delegate to Rust commands that look up the key from
 * Tauri-managed [`KeystoreState`](src-tauri/src/crypto/keystore.rs).
 */
export class EncryptionService {
  current = $state<EncryptionStatus>({ status: 'unknown' });

  async init(): Promise<void> {
    const r = await cryptoGetStatus();
    this.current = toStatus(r);
  }

  async encrypt(plaintext: string): Promise<string | null> {
    return cryptoEncrypt(plaintext);
  }

  async decrypt(value: string): Promise<string | null> {
    return cryptoDecrypt(value);
  }

  reset(): void {
    this.current = { status: 'unknown' };
  }
}

function toStatus(r: EncryptionStatusPayload | null): EncryptionStatus {
  if (!r) return { status: 'unknown' };
  if (r.status === 'active' && r.isOsBacked) {
    return { status: 'active', isOsBacked: true };
  }
  if (r.status === 'fallback' && !r.isOsBacked) {
    return { status: 'fallback', isOsBacked: false };
  }
  // Defensive fallthrough for unexpected combinations.
  return { status: 'unknown' };
}

export const encryptionService = new EncryptionService();
