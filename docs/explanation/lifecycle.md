---
order: 6
---

## 5. Extension Lifecycle — Birth to Death

```
                  App startup
                      │
          ┌─────────────────────┐
          │      DISCOVERY      │
          │                     │
          │  Rust scans 3 dirs: │
          │  1. dev_extensions  │
          │  2. built-in feats  │
          │  3. installed exts  │
          │                     │
          │  Reads manifest.json│
          │  Validates semver   │
          │  compat checks      │
          └──────────┬──────────┘
                     │ manifest loaded
          ┌──────────▼──────────┐
          │    MANIFEST LOADED  │
          │    (idle state)     │
          │                     │
          │  Registered in      │
          │  ExtensionBridge.   │
          │  Commands indexed.  │
          │  Permissions synced │
          │  to Rust registry.  │
          │                     │
          │  For searchable:    │
          │  background iframe  │
          │  spawned silently.  │
          └──────────┬──────────┘
                     │ user invokes command
          ┌──────────▼──────────┐
          │     INITIALIZE      │
          │                     │
          │  Iframe created.    │
          │  asyar-extension:// │
          │  URL loaded.        │
          │                     │
          │  main.ts runs:      │
          │  - ExtensionContext │
          │  - setExtensionId() │
          │    └─ self-registers│
          │       with bridge,  │
          │       drains any    │
          │       pending prefs │
          │  - postMessage      │
          │    'loaded' signal  │
          └──────────┬──────────┘
                     │ host receives 'loaded' signal
                     │ replies with asyar:event:preferences:set-all
                     │ (bundle: extension + commands prefs)
          ┌──────────▼──────────┐
          │      ACTIVATE       │
          │                     │
          │  extension.activate()
          │  Svelte component   │
          │  mounts in iframe.  │
          │  Actions registered.│
          │  context.preferences│
          │  snapshot installed │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │      ACTIVE         │
          │                     │
          │  User interacts.    │
          │  Services available.│
          │                     │
          │  Incoming events:   │
          │  - search queries   │
          │  - view:search      │
          │  - view:submit      │
          │  - keydown fwds     │
          │  - command invokes  │
          │  - action:execute   │
          └──────────┬──────────┘
                     │ user closes view
          ┌──────────▼──────────┐
          │     DEACTIVATE      │
          │                     │
          │  extension.deactivate()
          │  onUnload callback  │
          │  Iframe destroyed.  │
          └─────────────────────┘
```

### Compatibility checks at discovery

When Asyar discovers an extension, it validates the following constraints from the manifest:

| Field           | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platforms`     | Checked **first**. If present, the current OS must appear in the list. If not, the extension is marked `PlatformNotSupported` and will not load or appear in the store on that OS.                                                                                                                                                                                                                                                                                                      |
| `asyarSdk`      | Compared (semver) against the app's bundled SDK version (`SUPPORTED_SDK_VERSION` in `discovery.rs`, currently `1.10.2`). If `required` > `supported`, the extension is marked `SdkMismatch` and will not load.                                                                                                                                                                                                                                                                          |
| `minAppVersion` | Compared against the app's version. If the app is too old, the extension is marked `AppVersionTooOld`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `preferences`   | Extension-level and command-level declarations are validated by `validate_preferences` in `discovery.rs`. Any invalid declaration (bad `name`, unknown `type`, dropdown without `data`, dropdown `default` not in `data[]`, non-boolean checkbox default, non-numeric number default, duplicate names within a scope) **skips the entire extension** with a warning. This is intentionally fail-loud — invalid manifests are a developer error, not a runtime condition to work around. |

If none of these fields are present, the extension is marked `Unknown` (compatible by default).

---

### Feature lifecycle & disableability policy

Asyar enforces an explicit lifecycle policy distinguishing required core infrastructure from optional bundled features and installed extensions:

1. **Required Core Infrastructure (Built-ins)**
   - Only recovery/platform infrastructure (`settings` and `system`) is non-disableable (`lifecycle.disableable: false`).
   - The Rust extension lifecycle strictly rejects any request to disable a non-disableable built-in.
   - In Settings → Extensions, required built-ins display a non-interactive, checked toggle with a tooltip explaining that core infrastructure cannot be disabled.

2. **Optional Bundled Features (Tier 1 Built-ins)**
   - Every user-facing bundled feature explicitly declares `"lifecycle": { "disableable": true }` in its `manifest.json`.
   - Disabling removes that bundled feature's commands, search contributions, actions, accessories, views, and deeplink entry points without deleting its stored data.
   - Platform services remain available to permission-authorized Tier 2 replacements; disabling an Asyar-provided interface does not disable the underlying extension API.
   - **Clipboard History** is the reference service/feature split:
     - Disabling it releases the bundled feature's scoped capture subscription immediately.
     - Native clipboard listeners are torn down only when no other authorized capture consumer remains.
     - Search contributions and commands are omitted from search indexing.
     - Any active Clipboard History views are closed cleanly.
     - Direct command and deeplink invocations are rejected.
     - Existing history in SQLite is preserved (disabling does not delete data).
     - Shared clipboard read/write capabilities (`readCurrentText`, `writeToClipboard`, etc.) remain fully functional for authorized callers.
     - Re-enabling restores the bundled subscription, search contributions, and views idempotently.
   - **File Search** service/UI boundary:
     - Disabling the bundled `file-search` feature removes its commands (`cmd_file-search_show-files`), views (`file-search/DefaultView`), view actions, root-search fallback item, and deeplink entry points.
     - Disabling does not stop or disable the underlying platform service (`FileIndexState`, file watcher, indexing, and SQLite persistence).
     - Permission-authorized Tier 2 extensions retain full access to Asyar's file APIs (`files:search`, `files:status`, `files:read`, `files:glob`, `files:thumbnail`) via `IFilesService` / `ExtensionIpcRouter` while the bundled UI is disabled.
     - Existing indexed data, pinned files (`file_search_pinned`), selection learning (`file_search_selections`), and user configuration are preserved across disable/re-enable.
     - Re-enabling the bundled feature restores its contributions idempotently without duplicate registrations, watchers, or results.
     - Any active File Search view closes cleanly upon disabling.
   - **Notes** service/UI boundary:
     - Disabling the bundled `notes` feature removes its commands (`cmd_notes_open-notes`, `cmd_notes_quick-note`, `cmd_notes_new-sticky`, `cmd_notes_append-today`), views (`notes/DefaultView`), view actions (`notes:add`, `notes:toggle-pin`, `notes:duplicate`, `notes:copy-markdown`, `notes:stick-to-desktop`, `notes:export-markdown`, `notes:delete`), and deeplink entry points.
     - Disabling does not stop or disable the underlying notes platform service (`notesService` / Rust SQLite persistence layer).
     - Permission-authorized Tier 2 extensions retain full access to Asyar's notes APIs (`notes:read`, `notes:write`) via `INotesService` (`notes.search`, `notes.get`, `notes.create`, `notes.append`, `notes.list`) while the bundled UI is disabled.
     - Existing stored notes and pinned note states in SQLite are preserved across disable/re-enable.
     - Re-enabling the bundled feature restores its contributions and reloads the note store idempotently without duplicate listeners or state leaks.
     - Any active Notes view closes cleanly upon disabling.
   - **Runs** service/UI boundary:
     - Disabling the bundled `runs` feature removes its commands (`cmd_runs_open-runs`), views (`runs/RunView`), view actions (`runs:clear-recent`, `agents:open-run-in-chat`), and deeplink entry points.
     - Disabling does not stop or disable the underlying run tracking and background task engine (`RunService` / Rust process management).
     - Permission-authorized Tier 2 extensions retain full access to Asyar's run management APIs (`runs:track`) via `IRunService` (`runs.start`, `runs.write`, `runs.done`, `runs.fail`, `runs.cancel`, `runs.loadHistory`) while the bundled UI is disabled.
     - Existing execution history and run logs in SQLite are preserved across disable/re-enable.
     - Re-enabling the bundled feature restores its view contributions and reloads history idempotently.
     - Any active Runs view closes cleanly upon disabling.
   - **Snippets** service/UI boundary:
     - Disabling the bundled `snippets` feature removes its commands (`cmd_snippets_open-snippets`), views (`snippets/DefaultView`), view actions (`snippets:add`, `snippets:paste`, `snippets:edit`, `snippets:delete`, `snippets:copy-expansion`, `snippets:duplicate`, `snippets:toggle-pin`, `snippets:clear-all`), and deeplink entry points.
     - Disabling does not stop or disable the native shortcode text expansion engine in Rust or purge snippet records from SQLite.
     - Permission-authorized Tier 2 extensions retain full access to contribute or revoke shortcodes dynamically (`asyar:api:snippets:registerShortcodes`, `asyar:api:snippets:unregisterShortcodes` via `snippets:contribute`) while the bundled UI is disabled.
     - Existing user snippets, keyword triggers, and encrypted expansions in SQLite are preserved across disable/re-enable.
     - Re-enabling the bundled feature restores its contributions and reloads snippets idempotently.
     - Any active Snippets view closes cleanly upon disabling.
   - **Store infrastructure** service/UI boundary:
     - Disabling the bundled `store` feature removes its commands (`cmd_store_browse`), views (`store/DefaultView`, `store/DetailView`), and detail/list view actions (`install`, `uninstall`, `update`).
     - Disabling does not stop or disable the core extension/runtime management APIs, download pipeline, or runtime registry in Rust (`install_extension_from_url`, `uninstall_extension`, `list_installed_extensions`, `check_extension_consent`).
     - Installed extensions, consent configurations, downloaded runtimes, and local installations remain intact and continue executing while the Store UI is disabled.
     - Re-enabling the bundled feature restores store browsing and detail views idempotently without dangling modal or keyboard subscriptions.
     - Any active Store views close cleanly upon disabling.
   - **Walkthrough engine** service/UI boundary:
     - Disabling the bundled `walkthrough` feature removes its commands (`cmd_walkthrough_show-walkthrough`), views (`walkthrough/DefaultView`), view actions (`walkthrough:mark-complete`, `walkthrough:mark-all-complete`, `walkthrough:dismiss`, `walkthrough:reset`), root-search progress accessory, and deeplink entry points.
     - Disabling does not stop or disable the underlying walkthrough rules engine or erase task progress.
     - Platform launch observers, state probe evaluations, and task completions in SQLite (`walkthrough_completions`) continue tracking habit formation seamlessly in the background.
     - Earned completion timestamps and dismissed states are preserved across disable/re-enable.
     - Re-enabling the bundled feature restores the walkthrough view and search progress accessory idempotently.
     - Any active Walkthrough view closes cleanly upon disabling.
   - **Agents** service/UI boundary:
     - Disabling the bundled `agents` feature removes its commands (`cmd_agents_open`, `cmd_agents_create-agent`, `cmd_agents_view-chats`), views (`agents/DefaultView`), context mode registrations (`agents`), and deeplink entry points.
     - Disabling does not stop or disable the underlying AI agent runtime or model execution engine in Rust (`AgentManager`, active generation threads, provider integrations, SQLite chat threads).
     - Permission-authorized Tier 2 extensions retain full access to register custom agent tools (`tools:registerTool`, `tools:unregisterTool` via `IToolsService` with `tools:register` permission). Additionally, Tier 2 extensions can prompt the host's configured AI model directly via `IAiService` (`complete`, `stream`) with the `ai` permission.
     - Saved chat sessions, custom agents, and model configuration in SQLite are preserved across disable/re-enable.
     - Active chat views close cleanly and in-flight UI generation abort controllers are aborted safely upon deactivation.
     - Re-enabling the bundled feature restores agent chat views, commands, and context modes idempotently.
   - **Calculator** service/UI boundary:
     - Disabling the bundled `calculator` feature removes its root-search calculator interceptor/accessory and commands (`cmd_calculator_calculate`).
     - Disabling does not stop or disable the native calculation engine or live currency exchange rates service in Rust (`calculator_evaluate`, `calculator_configure`, `calculator_refresh_rates`).
     - Permission-authorized Tier 2 extensions retain full access to math evaluation and currency conversion via `ICalculatorService` (`calculator.evaluate()`) with the `calculator:evaluate` permission while the bundled UI is disabled.
     - User precision preferences and cached currency rates are preserved across disable/re-enable.
     - Re-enabling restores the search-bar math evaluator and calculator commands idempotently.
   - **MCP** service/UI boundary:
     - Disabling the bundled `mcp` feature removes its commands (`cmd_mcp_servers`), views (`mcp/DefaultView`), view actions, and deeplink entry points.
     - Disabling does not stop or disable the underlying Model Context Protocol client/server manager in Rust/platform service (`McpService`, active stdio/SSE server connections, tool catalog) used internally by the Agent engine.
     - Disabling the bundled UI removes server management views, while internal server connections remain active. No public Tier 2 API for direct MCP tool/resource access is currently exposed (planned follow-up).
     - Configured MCP servers, environment variables, and connection credentials in SQLite are preserved across disable/re-enable.
     - Active MCP management views close cleanly, and re-enabling restores the server management UI and views idempotently.
   - **Portals** service/UI boundary:
     - Disabling the bundled `portals` feature removes its commands (`cmd_portals_manage`), views (`portals/PortalManagerView`), view actions, and search index contributions (`portal:*`).
     - Disabling does not delete configured portals or credentials in SQLite (`portal_items`).
     - Custom web shortcuts and portals are purged from the search index on deactivation and re-indexed cleanly on activation.
     - Active portal manager views close cleanly upon deactivation.
     - Re-enabling restores the portal manager view and repopulates quick-launch portal search results idempotently.
   - **Screen OCR** service/UI boundary:
     - Disabling the bundled `screen-ocr` feature removes its commands (`cmd_screen-ocr_capture`), views, and deeplink entry points.
     - Disabling does not stop or disable the native platform OCR service in Rust (`ocr_capture_screen_text` / Apple Vision & Tesseract OCR backends).
     - Permission-authorized Tier 2 extensions retain full access to capture and extract screen text via `IScreenService` (`screen.captureText()`) with the `screen:capture` permission while the bundled UI is disabled.
     - Re-enabling restores the screen capture OCR command and action bindings idempotently.
     - Any active capture overlays or views close cleanly upon deactivation.
   - **Scripts** service/UI boundary:
     - Disabling the bundled `scripts` feature removes its commands (`cmd_scripts_library`, `cmd_scripts_create`), views (`scripts/DefaultView`), and view actions (`scripts:run`, `scripts:edit`, `scripts:delete`, `scripts:toggle-pin`).
     - Disabling does not stop or disable process execution in Rust or purge user scripts from SQLite (`user_scripts`).
     - Permission-authorized Tier 2 extensions retain full access to spawn external processes via `IShellService` (`shell.spawn()`) with the `shell:spawn` permission while the bundled UI is disabled. The user script library in SQLite is internal to the bundled feature and is not exposed as a Tier 2 script management API.
     - Saved script files, arguments, and execution configurations in SQLite are preserved across disable/re-enable.
     - Active script library views close cleanly, and running script processes are managed safely.
     - Re-enabling the bundled feature restores the script library view and command palette entries idempotently.
   - **Shortcuts** service/UI boundary:
     - Disabling the bundled `shortcuts` feature removes its commands (`cmd_shortcuts_manage`), views (`shortcuts/ShortcutManagerView`), and view actions (`shortcuts:record`, `shortcuts:remove`).
     - Disabling does not stop or disable the global hotkey listening service in Rust (`GlobalShortcutManager`), which continues listening for manifest-declared extension commands.
     - Disabling the bundled UI removes shortcut management and recording views; global shortcuts remain strictly manifest-declared and user-configured by design, with no public Tier 2 runtime API for dynamic shortcut registration.
     - Configured keybindings and assigned item shortcuts in SQLite (`item_shortcuts`) are preserved across disable/re-enable.
     - Active shortcut management views and recording modal listeners close cleanly upon deactivation.
     - Re-enabling restores the shortcut manager view idempotently.
   - **Usage Stats** service/UI boundary:
     - Disabling the bundled `usage-stats` feature removes its commands (`cmd_usage-stats_view`), views (`usage-stats/DefaultView`), and view actions (`usage-stats:export`, `usage-stats:reset`).
     - Disabling does not stop or disable the telemetry and usage logging platform service in Rust (`UsageTracker` / SQLite event logging).
     - App launch frequencies, command invocations, and extension usage metrics continue recording silently to ensure analytics consistency.
     - Historical usage data and streaks in SQLite are preserved across disable/re-enable.
     - Active usage stats views close cleanly, and re-enabling restores the stats dashboard idempotently.
   - **Window Management** service/UI boundary:
     - Disabling the bundled `window-management` feature removes its commands (`cmd_window-management_presets`, `cmd_window-management_left-half`, `cmd_window-management_right-half`, `cmd_window-management_maximize`, etc.), views (`window-management/PresetView`), and window switcher UI.
     - Disabling does not stop or disable the underlying native window manipulation and display geometry platform service in Rust (`window_move_resize`, `window_get_bounds`, `screen_get_displays`).
     - Permission-authorized Tier 2 extensions retain full access to window placement, tiling, and monitor query APIs via `ExtensionIpcRouter` while the bundled UI is disabled.
     - Saved window layouts and monitor presets in SQLite are preserved across disable/re-enable.
     - Active window management views close cleanly upon deactivation.
     - Re-enabling restores window preset views and quick-snap command contributions idempotently.
   - **Raycast Import** service/UI boundary:
     - Disabling the bundled `raycast-import` feature removes its commands (`cmd_raycast-import_import`), views (`raycast-import/ImportWizardView`), and view actions.
     - Disabling does not stop or disable the underlying manifest parser, Raycast script translator, or extension installer in Rust.
     - Any previously imported snippets, scripts, or extensions remain installed and functional in their respective platform stores.
     - In-progress import wizard state is cleared cleanly upon deactivation without leaking file handles.
     - Re-enabling restores the import wizard command and view idempotently.

3. **Tier 2 Installed Extensions**
   - Installed extensions default to `disableable: true`.
   - Disabling an installed extension unloads its iframe/worker, revokes active capabilities, and removes its commands from search indexing.
