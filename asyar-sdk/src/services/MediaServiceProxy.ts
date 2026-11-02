import type { IMediaService, MediaSessionInfo, MediaTransportAction } from './IMediaService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for native media control. The host's IPC router injects the
 * calling extension's ID, which the permission gate checks.
 */
export class MediaServiceProxy extends BaseServiceProxy implements IMediaService {
  async getNowPlaying(playerId?: string): Promise<MediaSessionInfo | null> {
    return this.broker.invoke<MediaSessionInfo | null>('media:getNowPlaying', {
      playerId: playerId ?? null,
    });
  }

  async listSessions(): Promise<MediaSessionInfo[]> {
    return this.broker.invoke<MediaSessionInfo[]>('media:listSessions', {});
  }

  async control(action: MediaTransportAction, playerId?: string): Promise<void> {
    return this.broker.invoke<void>('media:control', { action, playerId: playerId ?? null });
  }
}
