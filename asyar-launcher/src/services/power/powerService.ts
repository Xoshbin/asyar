import { invoke } from '@tauri-apps/api/core';
import type { KeepAwakeOptions, ActiveInhibitor } from 'asyar-sdk';

/**
 * Host-side thin wrapper over the Rust `power_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) so each method takes the caller id as its first
 * arg. Privileged host-context calls pass `null`.
 */
export const powerService = {
  async keepAwake(extensionId: string | null, options: KeepAwakeOptions): Promise<string> {
    return invoke<string>('power_keep_awake', { extensionId, options });
  },
  async release(extensionId: string | null, token: string): Promise<void> {
    return invoke<void>('power_release', { extensionId, token });
  },
  async list(extensionId: string | null): Promise<ActiveInhibitor[]> {
    return invoke<ActiveInhibitor[]>('power_list', { extensionId });
  },
};
