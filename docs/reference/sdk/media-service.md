### 8.41 `MediaService` — Now playing and transport control

**Runs in:** both worker and view.

**Permission required:** `media:control` for all three methods.

Read what is playing in a local media player and send play, pause, and skip commands. Works on **macOS**, **Windows** (System Media Transport Controls plus media keys) and **Linux** (MPRIS over D-Bus). A player that is not running is never launched.

| Platform | Players                                                            | `playerId` accepts                                                                                                                         |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | Music, TV, Spotify, VLC                                            | Alias (`"music"`, `"tv"`, `"spotify"`, `"vlc"`) or bundle id (`com.apple.Music`, `com.apple.TV`, `com.spotify.client`, `org.videolan.vlc`) |
| Windows  | Any app that publishes an SMTC session (Spotify, browsers, VLC, …) | The app user model id, or any case-insensitive substring of it (`"spotify"` matches `Spotify.exe`)                                         |
| Linux    | Any MPRIS player (Spotify, VLC, mpv, Firefox, …)                   | The full bus name (`org.mpris.MediaPlayer2.spotify`) or its suffix (`"spotify"`), case-insensitive                                         |

`MediaSessionInfo.playerId` is whatever identifies the player on that platform (bundle id, AUMID, or bus name). Round-trip it into `control()` instead of building ids by hand.

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

| Call                              | Behavior                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getNowPlaying()` (no `playerId`) | Picks among running players, preferring a `playing` session over `paused`. Resolves `null` if none has a track.                                            |
| `getNowPlaying(id)`               | Queries that player only. `null` if it is not running. Rejects for an unknown player id.                                                                   |
| `listSessions()`                  | Running supported players that are playing or paused. A player that fails to answer is skipped, not fatal.                                                 |
| `control(action)` (no `playerId`) | macOS: system media key. Windows: the current SMTC session, falling back to the media key. Linux: the active MPRIS player (playing preferred over paused). |
| `control(action, id)`             | Scripts that player directly. Rejects if the player is not running or the id is unknown.                                                                   |

For the media-key path (macOS always, Windows when there is no SMTC session), `play` and `pause` both map to the single play/pause key, so they toggle. Use a targeted call when you need a true `play` or `pause`. VLC on macOS only has a toggling `play`, so Asyar checks its state first for explicit `play`/`pause`; VLC exposes no artist or album.

**How it works under the hood:**

| Platform | Path                          | API                                                                                                                                   |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Untargeted transport          | System-defined media-key events (`NX_KEYTYPE_PLAY` / `FAST` / `REWIND`) posted with `CGEventPost`.                                    |
| macOS    | Targeted control, now-playing | In-process `NSAppleScript` against Music, TV, Spotify or VLC, only after confirming the app is already running.                       |
| Windows  | Sessions, targeted control    | `GlobalSystemMediaTransportControlsSessionManager` (SMTC): playback info, media properties and timeline per session.                  |
| Windows  | Untargeted transport          | The current SMTC session, then a synthesized `VK_MEDIA_*` key via `SendInput` if there is none or the app declines.                   |
| Linux    | Everything                    | MPRIS on the session bus: `ListNames` to discover `org.mpris.MediaPlayer2.*`, `Properties.GetAll` to read, Player methods to control. |

Asyar deliberately does not use `MediaRemote.framework`; Apple blocked it for third-party apps in macOS 15.4.

**First use (macOS):** the first scripted query or targeted control for each app makes macOS ask the user to allow Asyar to control it (Automation permission). That includes an untargeted `getNowPlaying()` or `listSessions()`, which script every running supported player. Each script waits at most 2 seconds for a reply, so an unresponsive player is skipped rather than freezing the launcher. If the user denies it, calls to that player reject with an `AppleScript failed` error and `listSessions()` omits it. Media-key transport may require Accessibility permission on some macOS versions.

**Linux:** with no session bus (for example a bare SSH session) every call rejects with an `MPRIS session bus unavailable` error. Players that run several instances appear as `org.mpris.MediaPlayer2.vlc.instance1234`; the bare name `"vlc"` still matches.

> **Pro Tip:** Prefer `getNowPlaying()` without an id for "what's playing" UIs and pass the returned `playerId` back to `control()` so your buttons act on the same player you are displaying.

---
