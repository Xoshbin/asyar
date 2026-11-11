# Cross-Platform Compatibility (macOS, Windows, Linux)

Asyar targets macOS, Windows, and Linux (X11 and Wayland). Local builds and `pnpm check:ci` only compile `#[cfg]` branches for the host OS; CI (`.github/workflows/test-and-lint.yml`) compiles, lints, and tests all three.

## 1. Platform Boundaries & Compilation

- **Crate & Module Split**: Put framework-free OS primitives in `src-tauri/crates/asyar-platform/` (`macos/`, `windows/`, `linux/`). Put Tauri-coupled OS code in `src-tauri/src/platform/` or trait-backed sibling modules (`power`, `system_actions`, `window_management`, `selection/platform`).
- **Keep All Targets Compiling**: When changing a shared trait, `AppState` field, `bootstrap` call, or `asyar-platform` re-export, update every `#[cfg(target_os = ...)]` implementation and provide a `#[cfg(not(...))]` stub where needed.
- **Test Pure Logic Everywhere**: Keep parsers, classifiers, and policy helpers un-gated (or `#[cfg(any(target_os = "...", test))]`) so Windows/Linux logic is unit-tested on macOS dev machines.

## 2. Paths, Filesystems & Schemes

- **No Verbatim `\\?\` Paths**: Use `dunce::canonicalize` or `dunce::simplified` instead of `std::fs::canonicalize`. Windows verbatim prefixes break `Path::starts_with` and `cmd.exe` / `.bat` / `.cmd` execution.
- **Case-Aware Security Checks**: Windows and macOS filesystems are case-insensitive (`CASE_INSENSITIVE_FS`). Use `files_scope::starts_with_case_aware` for root/deny-list checks, and check both `/` and `\` as path separators.
- **Windows Custom-Scheme Origin**: WebView2 serves custom schemes as `http://{scheme}.localhost/`. Rust URI handlers must strip `{scheme}://localhost/`, `{scheme}://`, and `http://{scheme}.localhost/`; extension CSPs and `getExtensionFrameOrigin()` must account for `http://asyar-extension.localhost`.

## 3. Subprocesses, Webviews & Display Servers

- **Suppress Windows Console Flash**: Set `CREATE_NO_WINDOW` (`0x0800_0000`) via `CommandExt::creation_flags` on `#[cfg(target_os = "windows")]` whenever spawning console-subsystem binaries (`powershell`, `where`, extension shell commands).
- **Sanitize Linux AppImage Children**: Call `crate::platform::linux::sanitize_command(&mut cmd)` before spawning external apps or `xdg-open` so AppImage `LD_LIBRARY_PATH` / `XDG_DATA_DIRS` overrides do not crash host binaries.
- **Use `tauri-plugin-http` from JS**: Webview/extension HTTP must go through `network:fetch` (`tauri-plugin-http`), never raw WebView `fetch()`, which fails CORS on Windows `tauri://` origins.
- **Per-Webview `data-platform` & Surfaces**: Every separate webview (`main`, `settings`, `onboarding`, `hud`) must set `document.documentElement.dataset.platform`. Match both `'win32'` and `'windows'` in Windows CSS selectors, and never set opaque root backgrounds.
- **Wayland Awareness**: Do not assume global hotkey grabs (`XGrabKey`), synchronous focus-on-show, or synthetic input/selection capture work on Wayland.

For full patterns, examples, and checklists, see `.agents/skills/cross-platform/SKILL.md`.
