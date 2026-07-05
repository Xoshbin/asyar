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

### File Search

Asyar indexes filenames across your home folder in the background (**Settings > File Search**). The index is a compact in-memory structure rebuilt on demand, backed by a snapshot on disk so restarts don't require a full rescan.

#### Default exclusions

Applied by both the initial scan and the live filesystem watcher (a single shared pattern list, so a file the scanner skips can never wake the watcher either):

`node_modules`, `.git`, `.cache`, `Library` (macOS app support/caches), `.Trash`, `.cargo/registry`, `.rustup`, `AppData/Local`, `target`, `__pycache__`, `dist`, `build`, `.venv`, `.next`, `.terraform`, `vendor`, `bower_components`, `.gradle`, `Pods`, `DerivedData`, `coverage`, `.pytest_cache`, `Virtual Machines.localized`, `VirtualBox VMs`.

App bundles (`.app`, `.framework`, `.photoslibrary`) and VM disk images (`.pvm`, `.vmwarevm`) are indexed as a single entry each — their contents are never scanned or watched individually.

> [!TIP]
> A running VM writes to its virtual disk continuously. If a custom VM location isn't covered by the default exclusions above, add its parent folder under **Exclude Patterns** — otherwise the watcher reacts to every write the guest OS makes, for as long as the VM is running.

#### Size cap

The index stops growing at 1,000,000 files and shows a "cap reached" warning in Settings. If you hit it, narrow **Search Roots** or add more **Exclude Patterns**.

#### Custom roots and exclusions

- **Search Roots** — empty means your whole home folder; add specific directories to narrow the scope instead.
- **Exclude Patterns** — glob patterns layered on top of the built-in list above (never replacing it).

Changing either triggers a background rebuild — the app stays responsive while it runs, and the Settings status card shows progress.

---
