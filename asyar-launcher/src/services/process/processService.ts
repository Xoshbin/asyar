import { invoke } from '@tauri-apps/api/core';
import type { AppGroup, KillResult, ProcessSortBy } from 'asyar-sdk/contracts';

/**
 * Host-side thin wrapper over the Rust `process_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) and spreads the SDK proxy payload POSITIONALLY
 * (`[extensionId, ...Object.values(payload)]`) — it does NOT pass the payload
 * as a single object. So these signatures must be positional and match the
 * proxy's payload-key insertion order exactly:
 *   ProcessServiceProxy.list  sends { query, sortBy }
 *   ProcessServiceProxy.kill  sends { pids, force, confirmedProtected }
 * Privileged host-context calls pass `null` for `extensionId`.
 */
export const processService = {
  async list(
    extensionId: string | null,
    query: string | undefined,
    sortBy: ProcessSortBy,
  ): Promise<AppGroup[]> {
    return invoke<AppGroup[]>('process_list', { extensionId, query, sortBy });
  },
  async kill(
    extensionId: string | null,
    pids: number[],
    force: boolean,
    confirmedProtected: boolean,
  ): Promise<KillResult> {
    return invoke<KillResult>('process_kill', { extensionId, pids, force, confirmedProtected });
  },
};
