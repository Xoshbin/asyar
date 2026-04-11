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

| Field | Check |
|---|---|
| `platforms` | Checked **first**. If present, the current OS must appear in the list. If not, the extension is marked `PlatformNotSupported` and will not load or appear in the store on that OS. |
| `asyarSdk` | Compared (semver) against the app's bundled SDK version (`SUPPORTED_SDK_VERSION` in `discovery.rs`, currently `1.10.2`). If `required` > `supported`, the extension is marked `SdkMismatch` and will not load. |
| `minAppVersion` | Compared against the app's version. If the app is too old, the extension is marked `AppVersionTooOld`. |
| `preferences` | Extension-level and command-level declarations are validated by `validate_preferences` in `discovery.rs`. Any invalid declaration (bad `name`, unknown `type`, dropdown without `data`, dropdown `default` not in `data[]`, non-boolean checkbox default, non-numeric number default, duplicate names within a scope) **skips the entire extension** with a warning. This is intentionally fail-loud — invalid manifests are a developer error, not a runtime condition to work around. |

If none of these fields are present, the extension is marked `Unknown` (compatible by default).

---
