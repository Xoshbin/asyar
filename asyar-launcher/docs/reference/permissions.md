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
| `shell:execute` | Execute shell commands | Future `ShellService.execute()`; also gates `asyar:api:invoke` |
| `shell:open-url` | Open a URL in the system browser | `window.parent.postMessage({ type: 'asyar:api:opener:open', url })` |
| `entitlements:read` | Read the user's active subscription entitlements | `EntitlementService.check()`, `.getAll()` |
| `selection:read` | Read the user's currently selected text or selected file-manager items from the frontmost application | `SelectionService.getSelectedText()`, `.getSelectedFinderItems()` |
| `ai:use` | Stream responses from the user's configured AI provider | `AIService.stream()` |
| `oauth:use` | Run an OAuth 2.0 PKCE authorization flow with a third-party provider | `OAuthService.authorize()`, `.revokeToken()` |

### What happens if a permission is missing

When your extension calls a method that requires an undeclared permission, the host's permission gate intercepts the `postMessage` before it reaches any service implementation. The gate returns a structured error immediately:

```typescript
// Attempting to call notify() without "notifications:send" in manifest:
try {
  await notif.notify({ title: 'Hi', body: 'World' });
} catch (err) {
  // err.message: 'Extension "com.yourname.ext" called "asyar:api:notification:notify"
  //               but did not declare permission "notifications:send" in its manifest.json'
}
```

The extension is **not suspended or crashed** — it continues running. Only that specific blocked call fails.

### Principle of least privilege

Only declare permissions you actually use. Reviewers inspect the permissions list during store review and will reject extensions with undeclared or unnecessary permissions.

---
