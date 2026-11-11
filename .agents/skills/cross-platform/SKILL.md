---
name: cross-platform
description: Use when writing or modifying OS-specific Rust code, paths, subprocesses, custom URI schemes, webview CSS/origins, keyboard shortcuts, or platform-gated features across macOS, Windows, and Linux (X11/Wayland) in Asyar.
---

# Cross-Platform Compatibility in Asyar

## Overview

Asyar supports **macOS**, **Windows**, and **Linux (X11 and Wayland)**. Because developers typically run `pnpm check:ci` on one OS (usually macOS), platform-gated bugs on Windows or Linux only surface in CI unless you follow Asyar's established cross-platform patterns.

## When to Use

- Adding or editing code behind `#[cfg(target_os = ...)]`, `#[cfg(unix)]`, or `#[cfg(windows)]`
- Working in `asyar-platform`, `src-tauri/src/platform/`, `window_management`, `selection`, `power`, `system_actions`, `system_events`, or `shell`
- Manipulating filesystem paths, `canonicalize()`, path scopes, or URI schemes (`asyar-extension://`, `asyar-icon://`, `asyar-thumb://`)
- Spawning child processes, openers, or sidecars
- Adding webviews, `data-platform` CSS rules, `postMessage` origin checks, or HTTP requests from JS
- Handling global shortcuts, window focus/blur, or keyboard layout resolution

Do **not** load this skill for pure domain logic with no OS, path, window, process, or webview interaction.

---

## 1. Rust Platform Architecture & Testability

### Crate Boundaries

| Layer                  | Location                                                             | Responsibility                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework-free OS APIs | `asyar-launcher/src-tauri/crates/asyar-platform/src/`                | Native Win32/Cocoa/X11/Wayland/D-Bus wrappers, `ics`, `media`, `calendar`, `shortcuts`, `locale`, key resolvers (`windows_key_resolver`, `linux_key_resolver`). Zero Tauri dependency. |
| Tauri-coupled OS code  | `asyar-launcher/src-tauri/src/platform/`                             | Window handles (`NSPanel`, `HWND`, GTK window), dock icon policy, Linux D-Bus launcher service (`launcher_dbus`), Windows LL keyboard hook.                                            |
| Trait-backed features  | `power`, `system_actions`, `window_management`, `selection/platform` | Define a platform-neutral state + trait (`PowerBackend`, `SystemActionsBackend`) with `macos`, `windows`, `linux` sibling modules.                                                     |

### Compile Pure Logic Everywhere

Keep parsing, classification, and decision logic **un-gated** (or `#[cfg(any(target_os = "...", test))]`) and pass OS-specific inputs as parameters. This lets `cargo test --workspace` on macOS verify Windows and Linux logic.

- `asyar-platform/src/lib.rs` compiles `pub mod linux;` on non-Linux hosts (with `#![cfg_attr(not(target_os = "linux"), allow(dead_code))]` in submodules like `linux/media.rs`) so `.desktop` parsing, AppImage `calculate_sanitized_environment`, and MPRIS parsing test everywhere.
- `src-tauri/src/lib.rs` extracts `linux_webkit_dmabuf_env_var(is_linux, user_provided, opt_out)` so both branches are unit-tested on every OS.
- `src-tauri/src/system_actions/mod.rs` gates helpers with `#[cfg(any(target_os = "linux", test))]`.

### Keep Non-Host Targets Compiling

When changing a shared trait, `AppState` field, `bootstrap` call, or `asyar-platform` export:

1. Update all three `#[cfg(target_os = "macos" | "windows" | "linux")]` branches (or provide a `#[cfg(not(...))]` fallback stub, like `localized_bundle_name` in `asyar-platform/src/lib.rs`).
2. Never put an unused import or helper outside its matching `#[cfg(...)]` block — `cargo clippy --workspace --all-targets -- -D warnings` runs on both `ubuntu-latest` and `macos-latest` in CI and fails on dead-code/unused-import warnings.
3. Pass `cfg!(target_os = "...")` as a value rather than duplicating whole blocks when only a boolean differs (e.g., `OnboardingCursor::new(cfg!(target_os = "macos"))`).

---

## 2. Paths, Filesystems & URI Schemes

### Always Use `dunce` Instead of `std::fs::canonicalize`

`std::fs::canonicalize` returns UNC verbatim paths (`\\?\C:\...`) on Windows. Those break `Path::starts_with` against normal roots (`C:\...`) and fail when passed to `cmd.exe` / `.bat` / `.cmd` scripts.

```rust
// Good
let canonical_parent = dunce::canonicalize(parent)?;
let display_path = dunce::simplified(path).to_string_lossy().into_owned();

// Bad — breaks Windows Path::starts_with and cmd.exe
let canonical_parent = parent.canonicalize()?;
```

### Case-Insensitive Filesystem Checks

Windows (NTFS) and macOS (APFS/HFS+) compare paths case-insensitively (`CASE_INSENSITIVE_FS = cfg!(any(windows, target_os = "macos"))`). A naive `Path::starts_with` check on a security deny-list **fails open** on `c:\windows\...` or `~/library/keychains/...`.

- Use `files_scope::starts_with_case_aware(&path, &root)` for security containment checks.
- Check both `/` and `\` when classifying explicit paths vs `PATH` lookups (`shell/mod.rs::is_explicit_path`) and when rejecting traversal in flat-cache URI handlers (`uri_schemes.rs::read_cache_file`).
- Keep custom URL schemes at least 2 characters long (`opener_scope::validate_declared_scheme`) so a 1-letter scheme (`c:`) never collides with a Windows drive letter.
- Use the `file-id` crate (`file_index/file_id.rs`) for stable `(volume, id)` identity instead of nightly-only Windows `MetadataExt` APIs.

### Custom Schemes on Windows WebView2

WebView2 translates custom Tauri schemes (`asyar-extension://`, `asyar-icon://`, `asyar-thumb://`) into `http://{scheme}.localhost/`.

- **Rust scheme handlers (`uri_schemes.rs::scheme_path`)**: Strip all three forms case-insensitively: `{scheme}://localhost/`, `{scheme}://`, and `http://{scheme}.localhost/`.
- **Returning scheme URLs to JS**: Check `thumbnail/mod.rs` — return `http://asyar-thumb.localhost/{filename}` on Windows and `asyar-thumb://localhost/{filename}` elsewhere (note `icons.rs` / `lib/icon.ts` / `uri_schemes.rs` CSPs must permit `http://asyar-icon.localhost` alongside `asyar-icon:`).
- **Extension iframe origins (`lib/ipc/extensionOrigin.ts`)**: `getExtensionFrameOrigin()` returns `'http://asyar-extension.localhost'` on Windows and `'*'` on macOS/Linux (because WKWebView/WebKit serialize custom schemes as opaque `"null"` origins, causing `postMessage(msg, 'asyar-extension://...')` to throw).

---

## 3. Subprocesses, HTTP Stacks & Native Libraries

| Concern                      | macOS / Linux                                                                | Windows                                                             | Why / Where                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console child window         | N/A                                                                          | `child.creation_flags(0x0800_0000)` (`CREATE_NO_WINDOW`)            | Prevents console-subsystem binaries (`powershell`, `where`, extension scripts) from flashing a black window (`shell/mod.rs`, `application/service.rs`).                             |
| AppImage env leak            | Call `crate::platform::linux::sanitize_command(&mut cmd)` on Linux           | N/A                                                                 | Restores `*_ORIG` env vars (`LD_LIBRARY_PATH`, `XDG_DATA_DIRS`, `QT_PLUGIN_PATH`) so launched apps don't link bundled AppImage glib/Qt (`asyar-platform/src/linux/environment.rs`). |
| `PATH` lookup                | `which`                                                                      | `where` (with `CREATE_NO_WINDOW`; validate explicit paths directly) | `where.exe` rejects drive-letter paths (`shell/mod.rs::resolve_path`).                                                                                                              |
| CLI `.cmd` / `.bat` wrappers | `npm`, `code`                                                                | `npm-cmd` / `code-cmd` or `.cmd` aware                              | Windows Node/editor shims are `.cmd` batch scripts (`create-extension/scaffoldService.ts`).                                                                                         |
| Webview/extension HTTP       | `tauri-plugin-http` (`network:fetch`)                                        | `tauri-plugin-http` (`network:fetch`)                               | Raw WebView `fetch()` fails CORS on Windows `tauri://` / `http://tauri.localhost` (`Cargo.toml`). Never unify `reqwest` (host) with `tauri-plugin-http`.                            |
| Keychain / Secrets           | Keychain Services (macOS), Secret Service -> `FileKeyStore` fallback (Linux) | Credential Manager                                                  | `crypto/keystore.rs` degrades to `0600` `keystore-v1.dat` on headless/Secret-Service-free Linux.                                                                                    |
| Native static libs           | Pin static features (e.g., `liblzma-sys = { features = ["static"] }`)        | Same                                                                | Prevents macOS CI Homebrew `xz` dylib paths (`/opt/homebrew/...`) leaking into release binaries.                                                                                    |

---

## 4. Webviews, CSS & Window Lifecycle

### Multi-Webview `data-platform` & Styling

Asyar has multiple independent webviews (`main`, `settings`, `onboarding`, `hud`, `sticky`). Each webview owns a separate DOM and JS realm:

- **Set `data-platform` in every shell**: `AppShell.svelte`, `routes/settings/+page.svelte`, `routes/onboarding/+layout.svelte`, and `routes/hud/+page.svelte` each set `document.documentElement.dataset.platform`.
- **Match both Windows tokens in CSS**: `style.css` and component styles match both `'win32'` and `'windows'`:
  ```css
  html[data-platform='win32'] .foo,
  html[data-platform='windows'] .foo { ... }
  ```
- **Never set an opaque root background**: Platform layers own window composition (`NSPanel` + `apply_vibrancy` on macOS, `apply_blur` + `--win-acrylic-tint` + `backdrop-filter: none` on Windows, opaque surfaces on Linux). See `.agents/skills/design-language/SKILL.md`.

### Window Show / Hide / Focus

- **macOS**: `main` is converted to an `NSPanel` via `tauri_nspanel`; "hidden" parks it at alpha `0` and mouse-transparent so WebKit stays warm.
- **Linux Wayland**: Clients cannot self-focus; `set_focus()` sends an `xdg-activation` request that may be delayed or ignored (`input:follow_mouse`). `lib.rs` applies `BLUR_HIDE_GRACE` (`250 ms`) via `blur_hide_is_spurious` so premature `Focused(false)` events do not immediately hide the launcher.
- **Quitting**: Closing a window must never quit Asyar (`RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit()` in `lib.rs`); only explicit `app.exit(0)` paths quit.

---

## 5. Linux Wayland, X11 & WebKitGTK

- **Detect Wayland consistently**: Check `WAYLAND_DISPLAY` non-empty or `XDG_SESSION_TYPE` case-insensitively equal to `"wayland"` (`commands/shortcuts.rs`).
- **Global Shortcuts**: X11 `XGrabKey` / `tauri_plugin_global_shortcut` fails on Wayland. Wayland compositors invoke the `asyar-summon` sidecar (`asyar-launcher/src-tauri/asyar-summon`), which calls `org.asyar.Launcher1.Toggle` over D-Bus (`platform/linux/launcher_dbus.rs`) with single-instance CLI fallback.
- **Input Simulation & Selection Capture**: Snippet expansion and `selection:read` clipboard-trick fallback work on macOS, Windows, and X11, and are unsupported on Wayland.
- **WebKitGTK Rendering**: `lib.rs::apply_linux_webkit_dmabuf_workaround()` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before webview creation unless user-set or `ASYAR_ALLOW_WEBKIT_DMABUF=1`. AppImage builds also install a Fontconfig rule hiding COLRv1 fonts from FreeType ABI mismatches.
- **Packaging**: Linux-specific Tauri config lives in `tauri.linux.conf.json` (bundles `asyar-summon`, declares `libxdo3` `.deb` dependency).

---

## 6. Shortcuts, Input & OS Copy

- **Canonical Action Shortcuts**: Use `Mod[+Alt][+Shift]+Key` (`lib/keyboard/actionShortcut.ts`) where `Mod` renders/binds `⌘` on macOS and `Ctrl` on Windows/Linux. Never use raw `⌘`, `Super`, or `Ctrl` in action declarations.
- **Platform Detection in TS**: Use `getHostPlatform()` (`lib/keyboard/hostPlatform.ts`) or `@tauri-apps/plugin-os` `platform()`. Do not hand-roll inconsistent `navigator.userAgent` checks unless running in an environment without Tauri plugin init (such as `asyar-sdk/src/environment.ts` or bare `/hud`).
- **Keyboard Layouts**: Never assume US QWERTY for global key hooks; route through `windows_key_resolver` / `linux_key_resolver` in `asyar-platform`.
- **OS Terminology & Gates**: Gate macOS-only permissions UI (`AccessibilityGate.svelte`, `CalendarAccessRows.svelte`, `OsPermissionRows.svelte`, `showDockIcon`) on `platform() === 'macos'`, and account for OS wording differences (e.g., Windows `"Sign Out"` vs `"Log Out"` in `system/actions.ts`).

---

## 7. CI Verification Across OSes

Local `pnpm check:ci` only compiles and tests the current host OS. `.github/workflows/test-and-lint.yml` runs three jobs:

| Job                 | Runner           | What It Catches                                                                                                                                                                                                                                                             |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-and-lint`     | `ubuntu-latest`  | Frontend + SDK tests, Prettier, `check:design`, `svelte-kit sync` + `check`, generated file diffs, `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo doc` (`-D warnings`), `cargo test --workspace`, Linux Secret Service + `FileKeyStore` tests |
| `test-rust-windows` | `windows-latest` | `cargo test --workspace` on Windows, `windows_key_resolver` FR (AZERTY) + DE (QWERTZ) layout matrix, Windows Credential Manager keystore tests                                                                                                                              |
| `test-rust-macos`   | `macos-latest`   | `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings` for `unsafe` `objc2`/macOS code, Apple Keychain tests                                                                                                                                     |

Before concluding a cross-platform change:

1. Verify every `#[cfg(target_os = ...)]` module still matches the trait/function signature across all three OSes.
2. Run `pnpm check:ci` (or `pnpm check:ci:changed`) locally, and keep pure helpers un-gated so unit tests cover non-host branches.
