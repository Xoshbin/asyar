# StatusBarService — independent tray icons

**Runs in:** both worker and view. Tray icons that should stay current
when the launcher is closed must be registered and updated from the
worker.

**Permission required:** None.

Every top-level `IStatusBarItem` an extension registers becomes an
**independent menu-bar tray icon** owned by the host (Raycast's `MenuBarExtra`
model). There is no shared "Asyar" tray that extensions land under anymore —
Asyar keeps its own separate tray icon with only core controls (Settings /
Check for Updates / Quit).

> **Breaking change:** the pre-Beta "merge everything under one Asyar tray"
> behavior is gone. Extensions now render as peers of Asyar's own icon. See
> the migration note at the bottom.

## Interface

```typescript
interface StatusBarClickContext {
  itemPath: string[];   // ['top-id', 'submenu-id', ..., 'leaf-id']
  checked?: boolean;    // NEW state after native auto-toggle, when applicable
}

interface IStatusBarItem {
  id: string;
  icon?: string;        // Emoji / unicode / label prefix
  iconPath?: string;    // Absolute path or asyar-extension://{id}/path.png
  text: string;         // Tooltip at top level; label in submenus
  checked?: boolean;    // ✓ state — submenu only
  submenu?: IStatusBarItem[];
  enabled?: boolean;    // false greys out — submenu only
  separator?: boolean;  // divider — submenu only
  onClick?: (ctx: StatusBarClickContext) => void;
}

interface IStatusBarService {
  registerItem(item: IStatusBarItem): void;
  updateItem(id: string, updates: Partial<IStatusBarItem>): void;
  unregisterItem(id: string): void;
}
```

## Rules (enforced client-side AND in Rust)

### Top-level items

- `id` must be non-empty, unique among your extension's top-level items,
  and must not contain `:` (reserved path separator).
- At least one of `icon` or `iconPath` must be present. Without either the
  tray has no visual — registration is rejected.
- `separator`, `checked`, `enabled: false` are **not allowed** at the top
  level (they only make sense inside a submenu).
- `onClick` at the top level fires when the tray icon itself is clicked
  **and there is no submenu**. If a submenu is present, clicking the icon
  opens the dropdown natively and `onClick` does not fire.

### Submenu items

- Nesting depth capped at **4** (top level counts as 1).
- Sibling ids must be unique, except `separator: true` rows (id-less).
- Item ids must not contain `:`.
- `checked`, `enabled`, `separator` are only valid here.

### Icon paths

- `asyar-extension://{extensionId}/path/to/icon.png` — resolved against
  your extension's bundle.
- Absolute filesystem path (`/Users/…/icon.png`, `C:\…\icon.png`) — used
  verbatim.
- **Anything else** (http(s), file, relative paths) is rejected.
- Recommended size: **16×16 PNG** (macOS template-renders monochrome
  automatically when matching template conventions).
- Traversal (`..`) inside the `asyar-extension://` path is rejected.

## Example — Spotify-style "Now Playing"

```typescript
const statusBar = context.getService<IStatusBarService>('statusBar');

statusBar.registerItem({
  id: 'spotify-now-playing',
  iconPath: 'asyar-extension://com.example.spotify/assets/icon-16.png',
  text: '♪ In Rainbows',              // tooltip
  submenu: [
    {
      id: 'play',
      text: 'Play',
      checked: true,
      onClick: ({ checked }) => setPlaying(checked ?? true),
    },
    { separator: true },
    { id: 'next',     text: 'Next',     onClick: () => next() },
    { id: 'previous', text: 'Previous', onClick: () => previous() },
    {
      id: 'volume',
      text: 'Volume',
      submenu: [
        { id: 'mute',     text: 'Mute',     checked: false, onClick: ({ checked }) => setMuted(checked!) },
        { id: 'low',      text: '33%',      onClick: () => setVolume(33) },
        { id: 'medium',   text: '66%',      onClick: () => setVolume(66) },
        { id: 'high',     text: '100%',     onClick: () => setVolume(100) },
        // Depth 4 max — a submenu under any of these would be rejected.
      ],
    },
    { id: 'quit', text: 'Quit Spotify', enabled: false },
  ],
});
```

A separate **mug icon** could be registered by another extension — both
appear independently in the menu bar alongside Asyar's own tray.

## Updating state

```typescript
// Re-register with the toggled state after a check-item fires.
statusBar.updateItem('spotify-now-playing', {
  id: 'spotify-now-playing',
  iconPath: '...',
  text: '♪ Song B',
  submenu: [...],
});
```

`updateItem` is shorthand for "replace the tree for this id". The proxy
validates the merged result with the same rules above.

## Click payload wire format

Rust emits `asyar:tray-item-click` to the host with:

```json
{
  "extensionId": "com.example.spotify",
  "event": { "itemPath": ["spotify-now-playing", "volume", "medium"] }
}
```

For check items the `event` also carries the new post-toggle state:

```json
{
  "extensionId": "com.example.spotify",
  "event": { "itemPath": ["spotify-now-playing", "play"], "checked": false }
}
```

A top-level icon click (no submenu) fires with
`itemPath: ["spotify-now-playing"]`. If no `onClick` is registered for that
path, the click is a no-op.

## Platform matrix

| Capability                          | macOS         | Windows       | Linux (GTK)             |
| ----------------------------------- | ------------- | ------------- | ----------------------- |
| `iconPath` image in menu bar        | ✅            | ✅            | ✅                      |
| `icon` emoji with no `iconPath`     | ✅ text label | ⚠ 1×1 stub¹   | ⚠ 1×1 stub¹             |
| Submenus (click opens dropdown)     | ✅            | ✅            | ⚠ Varies by DE²         |
| `checked` rendering                 | ✅            | ✅            | ⚠ Varies by DE²         |
| `separator` rendering               | ✅            | ✅            | ✅                      |
| `enabled: false` greying            | ✅            | ✅            | ✅                      |

¹ Windows/Linux trays need a bitmap. When the extension supplies only an
emoji via `icon`, Asyar attaches a 1×1 transparent PNG so the tray still
registers — the user sees a blank icon with the tooltip. Provide `iconPath`
to avoid this.

² Linux tray fidelity depends on the desktop environment's GTK / libayatana
implementation. Submenu images are frequently stripped; checkbox items may
render as plain rows.

## Migration

Pre-Beta extensions relied on Asyar bundling their `{icon text}` pair as a
row under its shared tray. That path is removed. To migrate:

1. Add `iconPath` (preferred) or keep `icon` for emoji-only fallback.
2. Replace reliance on "click opens my default view" with explicit
   `onClick` handlers OR provide a `submenu` that surfaces your extension's
   actions directly from the menu bar.
3. Extension uninstall / disable tears down all your tray icons
   automatically — no cleanup code needed.
