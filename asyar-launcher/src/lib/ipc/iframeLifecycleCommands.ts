import { invoke } from '@tauri-apps/api/core';

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
}

export function dispatchToExtension(
  extensionId: string,
  message: IpcPendingMessage,
): Promise<IpcDispatchOutcome> {
  return invoke('dispatch_to_extension', { extensionId, message });
}

export function iframeReadyAck(
  extensionId: string,
  mountToken: number,
): Promise<IpcPendingMessage[]> {
  return invoke('iframe_ready_ack', { extensionId, mountToken });
}

export function iframeUnmountAck(extensionId: string): Promise<void> {
  return invoke('iframe_unmount_ack', { extensionId });
}

export function iframeMountTimeoutReported(
  extensionId: string,
  mountToken: number,
): Promise<void> {
  return invoke('iframe_mount_timeout_reported', { extensionId, mountToken });
}

export function getIframeLifecycleSnapshot(): Promise<IframeLifecycleSnapshotEntry[]> {
  return invoke('get_iframe_lifecycle_snapshot');
}
