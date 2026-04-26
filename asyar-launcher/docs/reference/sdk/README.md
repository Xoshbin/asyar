# SDK Reference

A Tier 2 extension runs in **two iframes** — a worker (`worker.html`) and
a view (`view.html`). Each iframe imports from a different SDK entry and
owns its own `ExtensionContext`. Services are accessed through
`ExtensionContext.getService<T>(serviceName)`.

```typescript
// Worker iframe — src/main.worker.ts
import { ExtensionContext } from 'asyar-sdk/worker';
import type { INotificationService } from 'asyar-sdk/contracts';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

const notifications = context.getService<INotificationService>('notifications');
```

```typescript
// View iframe — src/main.view.ts
import { ExtensionContext } from 'asyar-sdk/view';
import type { IFeedbackService } from 'asyar-sdk/contracts';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

const feedback = context.getService<IFeedbackService>('feedback');
```

The role assertion (`window.__ASYAR_ROLE__`) is checked at module load —
importing `asyar-sdk/view` from a worker bundle (or vice-versa) fails
fast with a clear error.

> ⚠️ **Create exactly one `ExtensionContext` per iframe.** The constructor attaches `focusin`/`focusout` listeners for input-focus tracking. Creating a second context (e.g. inside a Svelte component's `onMount`) attaches duplicate listeners, causes double IPC calls, and can break the ⌘K shortcut detection. Worker and view each get their own — that's expected — but each role should only ever instantiate one.

> ⚠️ **Never call `getService()` inside Svelte components.** Resolve services in `main.view.ts` and pass them as `$props()` to your components. This is the canonical pattern used by all scaffolded templates.

---

### Full service reference summary

The **Runs in** column states which iframe role exposes the proxy. `both`
means the proxy is in both the worker and view bags; `view` means it's
view-only (DOM-bound, user-interaction-driven). Each linked service page
expands the placement guidance.

| Service Name | Interface | Runs in | Permission | Primary Use |
|---|---|---|---|---|
| `LogService` | `ILogService` | both | None | Structured debug/info/warn/error logging |
| `NotificationService` | `INotificationService` | both (callbacks: worker) | `notifications:send` | System notification center |
| `ClipboardHistoryService` | `IClipboardHistoryService` | view | `clipboard:read/write` | Full clipboard access and history |
| `NetworkService` | `INetworkService` | both | `network` | Outbound HTTP requests |
| `SettingsService` | `ISettingsService` | view | None | Persistent key-value storage (legacy — prefer `StorageService`) |
| `StatusBarService` | `IStatusBarService` | both | None | Tray menu live items |
| `CommandService` | `ICommandService` | both | None | Runtime command registration |
| `ActionService` | `IActionService` | both | None | ⌘K Action Drawer |
| `ExtensionManager` | `IExtensionManager` | view | None | Navigation, panel control |
| `EntitlementService` | `IEntitlementService` | view | `entitlements:read` | Subscription feature gating |
| `StorageService` | `IStorageService` | both | `storage:read/write` | Scoped key-value persistence |
| `SelectionService` | `ISelectionService` | view | `selection:read` | Read selected text / selected file-manager items from the frontmost app |
| `FeedbackService` | `IFeedbackService` | view | None | Toast, HUD, and confirm dialog primitives |
| `AIService` | `IAIService` | both | `ai:use` | Stream responses from the user's configured AI provider |
| `OAuthService` | `IOAuthService` | both | `oauth:use` | OAuth 2.0 PKCE flow — authorize with third-party providers, cache & revoke tokens |
| `ShellService` | `IShellService` | both | `shell:spawn` | Spawn OS processes and stream stdout/stderr — wraps CLI tools like ffmpeg, git, docker |
| `InteropService` | `IInteropService` | view | `extension:invoke` | Invoke a command in another installed extension |
| `CacheService` | `ICacheService` | both | `cache:read/write` | General-purpose persistent cache with TTL support |
| `ApplicationService` | `IApplicationService` | both (subscriptions: worker) | `application:read`, `app:frontmost-watch` | Retrieve metadata (title, name, id) about the currently focused app |
| `WindowManagementService` | `IWindowManagementService` | view | `window:manage` | Read and set the bounds / fullscreen state of the frontmost OS window |
| `TimerService` | `ITimerService` | both | `timers:schedule`, `timers:cancel`, `timers:list` | Persistent one-shot timers that survive app quit (Pomodoro, reminders) |
| `PowerService` | `IPowerService` | both | `power:inhibit` | OS-level sleep inhibitors |
| `SystemEventsService` | `ISystemEventsService` | both (subscriptions: worker) | `systemEvents:read` | OS state-change push events (sleep, wake, lid, battery) |
| `FileSystemWatcherService` | `IFileSystemWatcherService` | view (pending worker redesign) | `fs:watch` (+ `permissionArgs.fs:watch`) | Watch declared directories for changes (Apple Shortcuts, SSH config, dotfiles). Roots-up coalesced `{ type: 'change', paths }` events. |

**Utilities (direct import, no `getService()`):**

| Export | Type | Description |
|---|---|---|
| `SearchEngine<T>` | Class | Two-tier fuzzy search (exact + subsequence/typo-tolerant) |
| `stripHtml(html)` | Function | Strip HTML tags, scripts, styles, decode entities |
| `stripRtf(rtf)` | Function | Strip RTF control words and formatting |

---

## Service pages

- **[LogService](./log-service.md)**
- **[NotificationService](./notifications.md)**
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
- **[WindowManagementService](./window-management-service.md)**
- **[TimerService](./timers.md)**
- **[FileSystemWatcherService](./file-system-watcher.md)**
- **[Preferences (declarative settings)](./preferences.md)**
- **[User-authored templates pattern](./user-templates-pattern.md)**
