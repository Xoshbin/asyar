# SDK Reference

All services are accessed through `ExtensionContext.getService<T>(serviceName)`. The context is created once in `main.ts` and the extension ID must be set before calling any service.

```typescript
import { ExtensionContext } from 'asyar-sdk';
import type { INotificationService } from 'asyar-sdk';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

const notifications = context.getService<INotificationService>('NotificationService');
```

> ⚠️ **Create exactly one `ExtensionContext` per iframe.** The constructor attaches `focusin`/`focusout` listeners for input-focus tracking. Creating a second context (e.g. inside a Svelte component's `onMount`) attaches duplicate listeners, causes double IPC calls, and can break the ⌘K shortcut detection.

> ⚠️ **Never call `getService()` inside Svelte components.** Resolve services in `main.ts` and pass them as `$props()` to your components. This is the canonical pattern used by all scaffolded templates.

---

### Full service reference summary

| Service Name | Interface | Permission | Primary Use |
|---|---|---|---|
| `LogService` | `ILogService` | None | Structured debug/info/warn/error logging |
| `NotificationService` | `INotificationService` | `notifications:send` | System notification center |
| `ClipboardHistoryService` | `IClipboardHistoryService` | `clipboard:read/write` | Full clipboard access and history |
| `NetworkService` | `INetworkService` | `network` | Outbound HTTP requests |
| `SettingsService` | `ISettingsService` | None | Persistent key-value storage |
| `StatusBarService` | `IStatusBarService` | None | Tray menu live items |
| `CommandService` | `ICommandService` | None | Runtime command registration |
| `ActionService` | `IActionService` | None | ⌘K Action Drawer |
| `ExtensionManager` | `IExtensionManager` | None | Navigation, panel control |
| `EntitlementService` | `IEntitlementService` | `entitlements:read` | Subscription feature gating |
| `StorageService` | `IStorageService` | `storage:read/write` | Scoped key-value persistence |
| `SelectionService` | `ISelectionService` | `selection:read` | Read selected text / selected file-manager items from the frontmost app |
| `FeedbackService` | `IFeedbackService` | None | Toast, HUD, and confirm dialog primitives |
| `AIService` | `IAIService` | `ai:use` | Stream responses from the user's configured AI provider |
| `OAuthService` | `IOAuthService` | `oauth:use` | OAuth 2.0 PKCE flow — authorize with third-party providers, cache & revoke tokens |
| `ShellService` | `IShellService` | `shell:spawn` | Spawn OS processes and stream stdout/stderr — wraps CLI tools like ffmpeg, git, docker |
| `InteropService` | `IInteropService` | `extension:invoke` | Invoke a command in another installed extension |
| `CacheService` | `ICacheService` | `cache:read/write` | General-purpose persistent cache with TTL support |
| `ApplicationService` | `IApplicationService` | `application:read` | Retrieve metadata (title, name, id) about the currently focused app |

**Utilities (direct import, no `getService()`):**

| Export | Type | Description |
|---|---|---|
| `SearchEngine<T>` | Class | Two-tier fuzzy search (exact + subsequence/typo-tolerant) |
| `stripHtml(html)` | Function | Strip HTML tags, scripts, styles, decode entities |
| `stripRtf(rtf)` | Function | Strip RTF control words and formatting |

---

## Service pages

- **[LogService](./log-service.md)**
- **[NotificationService](./notification-service.md)**
- **[ClipboardHistoryService](./clipboard-history-service.md)**
- **[NetworkService](./network-service.md)**
- **[SettingsService](./settings-service.md)**
- **[StatusBarService](./status-bar-service.md)**
- **[CommandService](./command-service.md)**
- **[ActionService](./action-service.md)**
- **[ExtensionManager](./extension-manager.md)**
- **[SearchEngine](./search-engine.md)**
- **[EntitlementService](./entitlement-service.md)**
- **[StorageService](./storage-service.md)**
- **[FeedbackService](./feedback-service.md)**
- **[SelectionService](./selection-service.md)**
- **[AIService](./ai-service.md)**
- **[OAuthService](./oauth-service.md)**
- **[ShellService](./shell-service.md)**
- **[InteropService](./interop-service.md)**
- **[CacheService](./cache-service.md)**
- **[ApplicationService](./application-service.md)**
- **[Preferences (declarative settings)](./preferences.md)**
- **[User-authored templates pattern](./user-templates-pattern.md)**
