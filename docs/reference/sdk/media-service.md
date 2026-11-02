### 8.41 `MediaService` — Now playing and transport control

**Runs in:** both worker and view.

**Permission required:** `media:control` for all three methods.

Read what is playing in a local media player and send play, pause, and skip commands. Supported players today are **Music** (`com.apple.Music`, alias `"music"`) and **Spotify** (`com.spotify.client`, alias `"spotify"`) on macOS. A player that is not running is never launched. Windows and Linux currently report no sessions and ignore control calls.

```typescript
type PlaybackStatus = 'playing' | 'paused' | 'stopped';
type MediaTransportAction = 'playPause' | 'play' | 'pause' | 'next' | 'previous';

interface MediaSessionInfo {
  playerId: string; // bundle id, e.g. "com.apple.Music"
  playerName: string; // e.g. "Music"
  status: PlaybackStatus;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  positionSeconds: number | null;
}

interface IMediaService {
  getNowPlaying(playerId?: string): Promise<MediaSessionInfo | null>;
  listSessions(): Promise<MediaSessionInfo[]>;
  control(action: MediaTransportAction, playerId?: string): Promise<void>;
}
```

**Manifest declaration:**

```json
{ "permissions": ["media:control"] }
```

**Usage — show the current track:**

```typescript
const media = context.getService<IMediaService>('media');

const track = await media.getNowPlaying(); // best running player
if (track) {
  console.log(`${track.title} — ${track.artist} [${track.playerName}, ${track.status}]`);
}
```

**Usage — target a specific player:**

```typescript
await media.control('next', 'spotify');
const sessions = await media.listSessions(); // only running players with a track
```

**Semantics:**

| Call                              | Behavior                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `getNowPlaying()` (no `playerId`) | Picks among running players, preferring a `playing` session over `paused`. Resolves `null` if none has a track. |
| `getNowPlaying(id)`               | Queries that player only. `null` if it is not running. Rejects for an unknown player id.                        |
| `listSessions()`                  | Running supported players that are playing or paused. A player that fails to answer is skipped, not fatal.      |
| `control(action)` (no `playerId`) | Sends a system media key (`play/pause`, `next`, `previous`) to whichever app currently owns the media keys.     |
| `control(action, id)`             | Scripts that player directly. Rejects if the player is not running or the id is unknown.                        |

For the media-key path, `play` and `pause` both map to the single play/pause key, so they toggle. Use a targeted call when you need a true `play` or `pause`.

**How it works under the hood (macOS):**

| Path                          | API                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Untargeted transport          | System-defined media-key events (`NX_KEYTYPE_PLAY` / `FAST` / `REWIND`) posted with `CGEventPost`.     |
| Targeted control, now-playing | In-process `NSAppleScript` against Music or Spotify, only after confirming the app is already running. |

Asyar deliberately does not use `MediaRemote.framework`; Apple blocked it for third-party apps in macOS 15.4.

**First use:** the first targeted call makes macOS ask the user to allow Asyar to control Music or Spotify (Automation permission). If the user denies it, calls to that player reject with an `AppleScript failed` error and `listSessions()` omits it. Media-key transport may require Accessibility permission on some macOS versions.

> **Pro Tip:** Prefer `getNowPlaying()` without an id for "what's playing" UIs and pass the returned `playerId` back to `control()` so your buttons act on the same player you are displaying.

---
