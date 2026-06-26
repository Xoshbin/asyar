import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export interface DevStateEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface DevSubscriptionSummary {
  key: string;
  role: 'worker' | 'view';
  installedAt: number;
  listenerCount: number;
}

// All dev-inspector calls are silent — this is dev-only background polling
// tooling (1s tick); a transient failure should stay a console debug log,
// not spam the diagnostics panel every second.

export async function forceRemountWorker(
  extensionId: string,
  hasBackgroundMain: boolean,
): Promise<boolean> {
  return invokeSafeVoid(
    'force_remount_worker',
    { extensionId, hasBackgroundMain },
    { silent: true },
  );
}

export async function stateGetAll(extensionId: string): Promise<DevStateEntry[] | null> {
  return invokeSafe<DevStateEntry[]>('state_get_all', { extensionId }, { silent: true });
}

export async function stateGetSubscriptions(
  extensionId: string,
): Promise<DevSubscriptionSummary[] | null> {
  return invokeSafe<DevSubscriptionSummary[]>(
    'state_get_subscriptions',
    { extensionId },
    { silent: true },
  );
}
