import { invokeSafe } from './invokeSafe';

export type DispatchMessageKind =
  | 'command'
  | 'action'
  | 'viewSubmit'
  | 'viewSearch'
  | 'predictiveWarm';

export type DispatchTriggerSource =
  | 'search'
  | 'argument'
  | 'schedule'
  | 'timer'
  | 'deeplink'
  | 'notification'
  | 'invoke'
  | 'userHighlight';

export interface IpcPendingMessage {
  kind: DispatchMessageKind;
  payload: Record<string, unknown>;
  source: DispatchTriggerSource;
}

export type IpcDispatchOutcome =
  | { kind: 'readyDeliverNow'; messages: IpcPendingMessage[] }
  | { kind: 'mountingWaitForReady' }
  | { kind: 'needsMount'; mountToken: number }
  | { kind: 'degraded'; strikes: number };

export interface IframeLifecycleSnapshotEntry {
  extensionId: string;
  state: 'dormant' | 'mounting' | 'ready' | 'degraded';
  mailboxLen: number;
  role: 'worker' | 'view';
}

export function dispatchToExtension(
  extensionId: string,
  message: IpcPendingMessage,
  role: 'view' | 'worker',
): Promise<IpcDispatchOutcome | null> {
  return invokeSafe('dispatch_to_extension', { extensionId, message, role });
}

export function iframeReadyAck(
  extensionId: string,
  mountToken: number,
  role: 'view' | 'worker',
): Promise<IpcPendingMessage[] | null> {
  return invokeSafe('iframe_ready_ack', { extensionId, mountToken, role });
}

export async function iframeUnmountAck(extensionId: string, role: 'view' | 'worker'): Promise<void> {
  await invokeSafe('iframe_unmount_ack', { extensionId, role });
}

export async function iframeMountTimeoutReported(
  extensionId: string,
  mountToken: number,
): Promise<void> {
  await invokeSafe('iframe_mount_timeout_reported', { extensionId, mountToken });
}

export function getExtensionRuntimeSnapshot(): Promise<IframeLifecycleSnapshotEntry[] | null> {
  return invokeSafe('get_extension_runtime_snapshot');
}

// Silent: appInitializer.ts is the sole caller and reports its own diagnostic.
export function restoreWorkers(): Promise<string[] | null> {
  return invokeSafe('restore_workers', undefined, { silent: true });
}
