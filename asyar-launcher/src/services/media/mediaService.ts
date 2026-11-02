import type { MediaSessionInfo, MediaTransportAction } from 'asyar-sdk/contracts';
import { mediaGetNowPlaying, mediaListSessions, mediaControl } from '../../lib/ipc/systemCommands';

/**
 * Host-side thin wrapper over the Rust `media_*` Tauri commands.
 *
 * The ExtensionIpcRouter auto-injects the caller's `extensionId` (see
 * `INJECTS_EXTENSION_ID`) as the first arg; privileged host calls pass `null`.
 */
export const mediaService = {
  async getNowPlaying(
    extensionId: string | null,
    playerId?: string | null,
  ): Promise<MediaSessionInfo | null> {
    return mediaGetNowPlaying(extensionId, playerId ?? null);
  },
  async listSessions(extensionId: string | null): Promise<MediaSessionInfo[]> {
    return mediaListSessions(extensionId);
  },
  async control(
    extensionId: string | null,
    action: MediaTransportAction,
    playerId?: string | null,
  ): Promise<void> {
    await mediaControl(extensionId, action, playerId ?? null);
  },
};
