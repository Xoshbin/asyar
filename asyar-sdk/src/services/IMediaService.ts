export type PlaybackStatus = 'playing' | 'paused' | 'stopped';

export type MediaTransportAction = 'playPause' | 'play' | 'pause' | 'next' | 'previous';

export interface MediaSessionInfo {
  /** Bundle identifier of the player, e.g. `com.apple.Music`. */
  playerId: string;
  /** Display name, e.g. `Music`. */
  playerName: string;
  status: PlaybackStatus;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  positionSeconds: number | null;
}

/**
 * Now-playing info and transport control for local media players.
 *
 * macOS supports Music (`com.apple.Music` / `"music"`) and Spotify
 * (`com.spotify.client` / `"spotify"`). A player that is not running is never
 * launched. Other platforms currently report no sessions and ignore control
 * calls. Requires the `media:control` manifest permission.
 */
export interface IMediaService {
  /**
   * The current track of `playerId`, or of the best running player (playing
   * preferred over paused) when omitted. `null` when nothing is playing.
   */
  getNowPlaying(playerId?: string): Promise<MediaSessionInfo | null>;

  /** All running supported players that currently have a track. */
  listSessions(): Promise<MediaSessionInfo[]>;

  /**
   * Sends a transport action. Without `playerId` it is sent as a system media
   * key and reaches whichever app currently owns the media keys.
   */
  control(action: MediaTransportAction, playerId?: string): Promise<void>;
}
