// asyar-launcher/src/lib/ipc/clipboardCaptureCommands.ts
// Tauri command wrappers for clipboard capture subscription management.
import { invoke } from '@tauri-apps/api/core';

export type CaptureTransition = 'start' | 'stop' | 'noChange';

export interface CaptureSubscriptionResult {
  active_consumers: string[];
  transition: CaptureTransition;
}

export async function clipboardCaptureSubscribe(
  callerId: string,
): Promise<CaptureSubscriptionResult> {
  return invoke<CaptureSubscriptionResult>('clipboard_capture_subscribe', { callerId });
}

export async function clipboardCaptureUnsubscribe(
  callerId: string,
): Promise<CaptureSubscriptionResult> {
  return invoke<CaptureSubscriptionResult>('clipboard_capture_unsubscribe', { callerId });
}

export async function clipboardCaptureForceRemove(
  extensionId: string,
): Promise<CaptureSubscriptionResult> {
  return invoke<CaptureSubscriptionResult>('clipboard_capture_force_remove', { extensionId });
}

export async function clipboardCaptureGetConsumers(): Promise<string[]> {
  return invoke<string[]>('clipboard_capture_get_consumers');
}
