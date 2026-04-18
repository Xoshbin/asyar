---
order: 10
---
# Host OS Integration & Data Flow

## 8. OS Communication

Asyar relies strictly on Rust for handling raw Operating System tasks.

- **Global Hotkey Registration:** Managed via the `tauri_plugin_global_shortcut` crate. The core logic sits in `lib.rs:setup_global_shortcut()`.
  - **Conflict Handling:** If a shortcut registration fails (e.g., the user attempts to bind a key combination already reserved by the OS or another app), the `Err` is caught and logged to standard error (`eprintln!`). 
  - **User Experience:** Crucially, a hotkey conflict **does not crash the app**. Asyar continues its startup sequence and launches successfully. However, there is no automatic fallback hotkey assigned. The user will simply find the hotkey unresponsive and must use the System Tray icon to open the app and rebind the shortcut in settings.
- **System Tray (two independent code paths):**
  - **Asyar's own tray** lives in `src-tauri/src/tray.rs`. It owns a single fixed-menu `TrayIcon` (Settings / Check for Updates / Quit). Extensions never write to it, and its menu never mutates at runtime.
  - **Extension trays** live in `src-tauri/src/extension_tray/` (Raycast `MenuBarExtra` model). Each top-level `IStatusBarItem` an extension registers becomes its own `TrayIcon` keyed by `(extension_id, item_id)`, stored in `ExtensionTrayManager`. `registerItem` / `updateItem` / `unregisterItem` correspond to Tauri commands `tray_register_item` / `tray_update_item` / `tray_unregister_item`. There is no debounce and no shared menu rebuild — every call is forwarded straight to the manager.
  - Clicks on extension menu items fire `asyar:tray-item-click` with payload `{extensionId, event: {itemPath, checked?}}`; `trayClickBridge` (in `src/services/statusBar/`) fans the event to the owning iframe as `asyar:event:statusBar:click` so the SDK's `StatusBarServiceProxy` can dispatch the registered `onClick`. Clicks on Asyar's own tray are handled inline in `tray.rs` and are never forwarded to extensions.
  - Extension uninstall / disable in `extensions/lifecycle.rs` calls `ExtensionTrayManager::remove_all_for_extension` so every tray icon belonging to that extension vanishes immediately.
  - See `docs/reference/sdk/status-bar.md` for the SDK-facing contract and the platform fidelity matrix.
- **Filesystem Access:** Leverages `tauri_plugin_fs`. Host paths strictly use Tauri's path resolution API (`appDataDir()`) to ensure compliance with each platform's data directory conventions.
- **Clipboard Access:** Leveraged via the `tauri_plugin_clipboard_manager`.
- **Selection Capture:** The `selection:read` capability (exposed to extensions through `SelectionService`) reads the user's current selection — text from the frontmost app or items from the frontmost file manager — using platform-native accessibility APIs (macOS `AXUIElementCopyAttributeValue`, Windows `IUIAutomation` `TextPattern`, Linux AT-SPI2 via the `atspi` crate). When the accessibility fast path returns nothing (sandboxed apps, Electron processes, custom widgets), Asyar falls back to a clipboard-trick: snapshot → post Cmd+C/Ctrl+C to the frontmost app's PID (via `CGEventPostToPid` on macOS, `enigo` elsewhere) → poll the platform's clipboard change marker (`NSPasteboard.changeCount`, `GetClipboardSequenceNumber`, content hash on X11) for up to 250 ms → read → restore. Restore is RAII-guarded so any error path still puts the original clipboard contents back. macOS captures every clipboard MIME type for restore; Windows and Linux currently snapshot only the text representation. File-manager items are read via Finder AppleScript on macOS, `IShellWindows` COM enumeration matched against `previous_hwnd` on Windows, and a Tier-A clipboard URI list on Linux. A static `tokio::sync::Mutex` serialises selection operations across all extensions to prevent concurrent clipboard-trick races. Wayland is unsupported (same constraint as snippet expansion). The shared key-event posting helpers live in `src-tauri/src/platform/input.rs` and are used by both paste and copy code paths.
- **Window Management:** Asyar declares three windows in `tauri.conf.json`:
  - **`main` (the launcher)** behaves like a Spotlight search bar rather than a standard application window.
    - **macOS:** The app uses the `tauri_nspanel` crate. `window.to_spotlight_panel()?` converts the Tauri window into a native `NSPanel`. The app listens to `{SPOTLIGHT_LABEL}_panel_did_resign_key` (fired when the user clicks outside) to auto-hide via `panel.order_out(None)`, unless the window is pinned.
    - **Windows:** Visual composition uses `apply_blur`. Window focus-loss and hide behavior is handled through Tauri's standard window event system.
    - **Linux:** Window management follows Tauri's standard cross-platform APIs. Visual blur effects are not applied on Linux.
    - Visual composition effects are platform-gated: `apply_vibrancy` on macOS, `apply_blur` on Windows, no-op on Linux.
  - **`settings`** is a separate webview with its own JS context. It's loaded lazily and lives at `/settings`. Per-context singletons (auth, sync, feedback) are re-initialized inside `settings/+page.svelte`'s `onMount` because they live in a different JS realm than the main window's.
  - **`hud`** is a small transparent always-on-top webview at `/hud` used by the `FeedbackService.showHUD(...)` primitive. It is pre-declared with `visible: false` and is shown on demand by the `show_hud` Tauri command, which positions it at the bottom-center of the cursor's monitor (via the `monitor` toolkit crate), emits a `hud:show` event with the title, and schedules an auto-hide via a tracked `tauri::async_runtime::JoinHandle` stored in `HudState`. Lifecycle lives in `src-tauri/src/hud_window/service.rs`; the Tauri command `commands/hud.rs` is a thin wrapper. Because the HUD is its own window, it survives the main launcher window being hidden — that's the entire point of the primitive.

---

## 11. Data Flow Diagrams

### App Startup Sequence
```ascii
+------------+       +-------------+       +--------------+       +-------------------+       +-------+
| Tauri Init | ----> | Rust Setup  | ----> | WebView Load | ----> | SvelteKit Boots   | ----> | Ready |
+------------+       +-------------+       +--------------+       | (appInitializer)  |       +-------+
                                                                  +---------+---------+
                                                                            |
                                                                  +---------v---------+
                                                                  | ExtensionLoader   |
                                                                  | - glob Built-ins  |
                                                                  | - FS Installed    |
                                                                  +-------------------+
```

### Tier 1 Command Execution
```ascii
+------------+       +-------------------+       +-------------------------+
| User Input | ----> |   ResultsList     | ----> |  handleCommandAction()  |
+------------+       | (Select / Enter)  |       |  (extensionManager.ts)  |
                     +-------------------+       +-----------+-------------+
                                                             | navigateToView('ext_id/DefaultView')
+-------------------------+      +-------------------+       |
|    SvelteKit Reacts     | <--- | $activeView Store | <-----+
| (+page.svelte bounds)   |      |      Updates      |
+------------+------------+      +-------------------+
             | (isBuiltIn == true)
+------------v-------------+     +-------------------------+
| getLoadedExtensionModule | --> |  <svelte:component />   |
| (Extracts Svelte Class)  |     | (Mounts in Core DOM)    |
+--------------------------+     +-------------------------+
```

### Tier 2 Command Execution (Isolates)
```ascii
+------------+       +-------------------+       +-------------------------+
| User Input | ----> |   ResultsList     | ----> |  handleCommandAction()  |
+------------+       | (Select / Enter)  |       |  (extensionManager.ts)  |
                     +-------------------+       +-----------+-------------+
                                                             | navigateToView('ext_id/DefaultView')
+-------------------------+      +-------------------+       |
|    SvelteKit Reacts     | <--- | $activeView Store | <-----+
| (+page.svelte bounds)   |      |      Updates      |
+------------+------------+      +-------------------+
             | (isBuiltIn == false)
+------------v-------------+     +-------------------------+
|    <ExtensionIframe>     | --> | Rust URL Intercept      |
| src="asyar-extension://" |     | (stream from AppData)   |
+------------+-------------+     +-----------+-------------+
                                             |
+--------------------------+     +-----------v-------------+
| Extension Context Boots  | <-- |   index.html Injected   |
| (IPC & MessageBroker)    |     |   (Isolated Webview)    |
+--------------------------+     +-------------------------+
```

---
