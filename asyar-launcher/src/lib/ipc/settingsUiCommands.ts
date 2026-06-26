import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export interface PendingPairing {
  id: string;
  family: string;
  variant: string;
}

export async function browserListPendingPairings(): Promise<PendingPairing[] | null> {
  return invokeSafe<PendingPairing[]>('browser_list_pending_pairings');
}

// `browser_resolve_pairing`/`browser_revoke_pairing` are `Result<(), String>`
// on the Rust side — use invokeSafeVoid's boolean signal, silent because
// callers report their own specific diagnostic kind on failure.

export async function browserResolvePairing(
  pairingId: string,
  decision: 'allow' | 'deny',
): Promise<boolean> {
  return invokeSafeVoid('browser_resolve_pairing', { pairingId, decision }, { silent: true });
}

export async function browserRevokePairing(family: string, variant: string): Promise<boolean> {
  return invokeSafeVoid('browser_revoke_pairing', { family, variant }, { silent: true });
}
