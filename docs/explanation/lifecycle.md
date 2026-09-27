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
     - Permission-authorized Tier 2 extensions retain full access to Asyar's run management APIs (`runs:manage`) via `IRunService` (`runs.start`, `runs.write`, `runs.done`, `runs.fail`, `runs.cancel`, `runs.loadHistory`) while the bundled UI is disabled.
     - Existing execution history and run logs in SQLite are preserved across disable/re-enable.
     - Re-enabling the bundled feature restores its view contributions and reloads history idempotently.
     - Any active Runs view closes cleanly upon disabling.
   - **Snippets** service/UI boundary:
     - Disabling the bundled `snippets` feature removes its commands (`cmd_snippets_open-snippets`), views (`snippets/DefaultView`), view actions (`snippets:add`, `snippets:paste`, `snippets:edit`, `snippets:delete`, `snippets:copy-expansion`, `snippets:duplicate`, `snippets:toggle-pin`, `snippets:clear-all`), and deeplink entry points.
     - Disabling does not stop or disable the native shortcode text expansion engine in Rust or purge snippet records from SQLite.
     - Permission-authorized Tier 2 extensions retain full access to contribute or revoke shortcodes dynamically (`asyar:api:snippets:registerShortcodes`, `asyar:api:snippets:unregisterShortcodes` via `snippets:manage`) while the bundled UI is disabled.
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

3. **Tier 2 Installed Extensions**
   - Installed extensions default to `disableable: true`.
   - Disabling an installed extension unloads its iframe/worker, revokes active capabilities, and removes its commands from search indexing.
