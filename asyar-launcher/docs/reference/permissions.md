---
order: 3
---
## 10. Permissions Reference

Declare every permission your extension needs in `manifest.json`:

```json
{
  "permissions": ["network", "notifications:send", "clipboard:read"]
}
```

### Full permissions table

| Permission | What it unlocks | SDK methods that require it |
|---|---|---|
| `network` | Outbound HTTP requests | `NetworkService.fetch()` |
| `notifications:send` | System notification center | `NotificationService.notify()`, `.checkPermission()`, `.requestPermission()`, `.registerActionTypes()`, `.listenForActions()`, `.createChannel()` |
| `clipboard:read` | Read clipboard content and history | `ClipboardHistoryService.readCurrentClipboard()`, `.getRecentItems()` |
| `clipboard:write` | Write and manipulate clipboard | `ClipboardHistoryService.writeToClipboard()`, `.pasteItem()`, `.simulatePaste()`, `.toggleItemFavorite()`, `.deleteItem()`, `.clearNonFavorites()` |
| `storage:read` | Read from extension key-value store | `StorageService.get()`, `.getAll()` |
| `storage:write` | Write to extension key-value store | `StorageService.set()`, `.delete()`, `.clear()` |
| `fs:read` | Read files from the filesystem | Future `FileService.read()`, `.list()` |
| `fs:write` | Write files to the filesystem | Future `FileService.write()`, `.delete()` |
| `shell:spawn` | Spawn arbitrary OS processes and stream their stdout/stderr output | `ShellService.spawn()` |
| `shell:open-url` | Open a URL in the system browser | `window.parent.postMessage({ type: 'asyar:api:opener:open', url })` |
| `entitlements:read` | Read the user's active subscription entitlements | `EntitlementService.check()`, `.getAll()` |
| `selection:read` | Read the user's currently selected text or selected file-manager items from the frontmost application | `SelectionService.getSelectedText()`, `.getSelectedFinderItems()` |
| `ai:use` | Stream responses from the user's configured AI provider | `AIService.stream()` |
| `oauth:use` | Run an OAuth 2.0 PKCE authorization flow with a third-party provider | `OAuthService.authorize()`, `.revokeToken()` |
| `extension:invoke` | Invoke a command in another installed extension | `InteropService.launchCommand()` |
| `application:read` | One-shot queries on the `application:*` namespace (frontmost app, installed-app index, `isRunning`) **and** the `applicationIndex:*` push subscription (`onApplicationsChanged` — fires when an app is installed / removed or the user edits `settings.search.additionalScanPaths`). Index events carry the same data class as `listApplications`, so the same permission gates both surfaces. | `ApplicationService.getFrontmostApplication()`, `.listApplications()`, `.syncApplicationIndex()`, `.isRunning()`, `.onApplicationsChanged()` |
| `window:manage` | Read and set the position, size, and fullscreen state of the frontmost OS window. macOS requires Accessibility permission; Linux requires `xdotool`; Wayland not supported. | `WindowManagementService.getWindowBounds()`, `.setWindowBounds()`, `.setFullscreen()` |
| `power:inhibit` | Prevent the OS from sleeping while extension logic is running. macOS uses IOKit power assertions; Linux uses logind DBus (non-systemd systems return `PowerUnavailable`); Windows uses `SetThreadExecutionState`. | `PowerService.keepAwake()`, `.release()`, `.list()` |
| `systemEvents:read` | Subscribe to OS-level push events: sleep, wake, lid open/close, battery level, and AC/battery power-source changes. macOS uses `IORegisterForSystemPower` + IOKit polling; Linux and Windows watchers are stubs (subscriptions succeed but events never fire yet). | `SystemEventsService.onSystemSleep()`, `.onSystemWake()`, `.onLidOpen()`, `.onLidClose()`, `.onBatteryLevelChange()`, `.onPowerSourceChange()` |
| `app:frontmost-watch` | Subscribe on the `appEvents:*` namespace to application-presence push events: launched, terminated, frontmost-changed. macOS uses `NSWorkspace.notificationCenter`; Windows uses WMI + `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`; Linux uses `/proc` polling + DBus `NameOwnerChanged` + (X11 only) `_NET_ACTIVE_WINDOW`. Wayland sessions get launch/terminate but no frontmost events. Note the namespace split: `application:*` is query-only and stays under `application:read`; only the push subscriptions require this permission. | `ApplicationService.onApplicationLaunched()`, `.onApplicationTerminated()`, `.onFrontmostApplicationChanged()` |

### What happens if a permission is missing

When your extension calls a method that requires an undeclared permission, the host's permission gate intercepts the `postMessage` before it reaches any service implementation. The gate returns a structured error immediately:

```typescript
// Attempting to call send() without "notifications:send" in manifest:
try {
  await notif.send({ title: 'Hi', body: 'World' });
} catch (err) {
  // err.message: 'Extension "com.yourname.ext" called "asyar:api:notifications:send"
  //               but did not declare permission "notifications:send" in its manifest.json'
}
```

The extension is **not suspended or crashed** — it continues running. Only that specific blocked call fails.

### Principle of least privilege

Only declare permissions you actually use. Reviewers inspect the permissions list during store review and will reject extensions with undeclared or unnecessary permissions.

---
