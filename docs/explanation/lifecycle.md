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

3. **Tier 2 Installed Extensions**
   - Installed extensions default to `disableable: true`.
   - Disabling an installed extension unloads its iframe/worker, revokes active capabilities, and removes its commands from search indexing.
