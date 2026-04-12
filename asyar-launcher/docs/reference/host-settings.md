---
order: 11
---
## 11. Host Settings Reference

Asyar provides several system-level settings to customize behavior and application discovery.

### Application Search

Asyar automatically indexes applications from standard OS locations. If you have applications in non-standard folders or standalone binaries you'd like to reach via global search, use **Additional Scan Paths**.

#### Default Scan Paths

| Platform | Locations |
|---|---|
| **macOS** | `/Applications`, `/System/Applications`, `~/Applications` |
| **Windows** | Start Menu (`C:\ProgramData\Microsoft\Windows\Start Menu\Programs`, `~\AppData\Roaming\Microsoft\Windows\Start Menu\Programs`) |
| **Linux** | `/usr/share/applications`, `~/.local/share/applications` |

#### Additional Scan Paths

You can add custom directories to the application scanner in **Settings > Extensions > Applications -> Additional Scan Paths**.

- **Recursive Search**: Asyar will recursively scan these directories for executable bundles (like `.app` on macOS) or `.desktop` files (on Linux).
- **Standalone Binaries**: On Windows, it will also index `.exe` files found in these paths.
- **Index Sync**: Changes to these paths trigger an immediate background re-index of the application store.

> [!TIP]
> Use this feature for dedicated development folders, toolchains, or portable apps stored on external drives.

---
