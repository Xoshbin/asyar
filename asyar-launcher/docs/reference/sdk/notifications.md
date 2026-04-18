# NotificationService — desktop notifications with action buttons

**Permission required:** `notifications:send`

An extension calls `send()` with optional action buttons. When the user
clicks a button on the OS notification, the host looks the action up in
a Rust-side registry and invokes the extension's declared command
through the same dispatch path a search-result click or `asyar://`
deep link would take — the extension receives the fire via its normal
`executeCommand()` handler, no extra listener wiring required.

## Interface

```ts
interface NotificationAction {
  id: string;                     // action-local id (unique within the notification)
  title: string;                  // button label shown in the OS notification
  commandId: string;              // extension's command to fire (must be in manifest.json)
  args?: Record<string, unknown>; // JSON-serialisable args forwarded to the command
}

interface NotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  actions?: NotificationAction[];
}

interface INotificationService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  send(options: NotificationOptions): Promise<string>;   // returns notification id
  dismiss(notificationId: string): Promise<void>;        // drops pending actions + closes OS banner
}
```

## Full example — "Coffee ending in 1 minute"

```ts
import type { INotificationService } from 'asyar-sdk';

const notifications = context.getService<INotificationService>('notifications');

const notificationId = await notifications.send({
  title: 'Coffee ending in 1 minute',
  body: 'Extend or stop before the timer runs out.',
  actions: [
    { id: 'extend', title: 'Extend 30m', commandId: 'coffee.extend', args: { minutes: 30 } },
    { id: 'stop',   title: 'Stop now',  commandId: 'coffee.stop' },
  ],
});

// Later, if the countdown reaches zero before the user reacts:
await notifications.dismiss(notificationId);
```

`manifest.json` must declare both commands:

```json
{
  "commands": [
    { "id": "coffee.extend", "name": "Extend coffee", "resultType": "no-view" },
    { "id": "coffee.stop",   "name": "Stop coffee",   "resultType": "no-view" }
  ]
}
```

When the user clicks **Extend 30m**, the extension's `executeCommand('coffee.extend', { minutes: 30 })` fires. Asyar's window does **not** open — command dispatch is detached from view presentation.

## Dispatch flow

1. Extension calls `notifications.send({ actions: [...] })`.
2. SDK proxy validates each action locally (non-empty `id`/`title`/`commandId`, args JSON-serialisable) and forwards the whole payload to the host over postMessage.
3. Host's `NotificationService.send()` hits the Rust `send_notification` command, which:
   - validates the action list on the Rust side (`id`/`title`/`commandId` non-empty, args deserialisable),
   - inserts `(notificationId, actionId) → (extensionId, commandId, argsJson)` into the [`NotificationActionRegistry`](../../../src-tauri/src/notifications/registry.rs),
   - calls the platform backend to show the notification (see [Platform matrix](#platform-matrix)).
4. User clicks a button. The platform backend translates the click to `(notificationId, actionId)` and calls the registered click sink.
5. The click sink resolves the entry through [`dispatch::resolve_click`](../../../src-tauri/src/notifications/dispatch.rs), emits `asyar:notification-action` with `{ notificationId, actionId, extensionId, commandId, argsJson }`, and removes the whole notification's entries (OS-level actions are one-shot).
6. [`NotificationActionBridge`](../../../src/services/notification/notificationActionBridge.svelte.ts) (running in the launcher window) receives the Tauri event, validates the extension is still installed + enabled and the command is registered, and calls `commandService.executeCommand(objectId, args)`.
7. Extension's `executeCommand(commandId, args)` runs.

## Platform matrix

| OS | How it renders | Reliable action count | Notes |
|----|----------------|-----------------------|-------|
| macOS | `mac-notification-sys` → NSUserNotification | 1 primary + dropdown for 2+ | One action renders as a single button; multiple actions appear under an "Actions" dropdown menu. A "Close" button is always present. |
| Linux (GNOME, KDE, dunst) | `notify-rust` → xdg freedesktop | 2–4 typically | Depends on the notification daemon. KDE Plasma surfaces all actions inline; GNOME collapses them. |
| Windows | `tauri-plugin-notification` → toast | 0 | Action buttons are **dropped with a warning**; the notification still fires with title + body. |

When a platform can't render actions, the notification still delivers — the buttons are silently stripped from the UI and a warning is logged. Extensions should not crash or behave differently based on action support.

## Lifecycle

Pending-action entries are purged when any of the following happens:

- **User clicks an action** — the whole notification's entries are dropped after dispatch (one-shot semantics).
- **`notifications.dismiss(notificationId)`** — explicit cleanup.
- **Extension uninstall** — `NotificationActionRegistry::remove_all_for_extension` is called from `extensions::lifecycle::uninstall`, so stale buttons stop firing into nothing. Disable is **not** a purge trigger (matches `PowerRegistry` / `AppEventsHub`); the `NotificationActionBridge` instead drops clicks for disabled extensions at dispatch time, so re-enabling the extension keeps pending actions functional.
- **TTL expiry** — a background tokio task spawned during `setup_app` runs `purge_expired` every hour, dropping entries older than `DEFAULT_TTL` (24 h). This protects against the OS silently closing a notification without telling us.

If a user clicks a button on a notification whose extension has since been disabled or uninstalled, the click is logged and dropped — the extension is **not** auto-enabled. If the command was removed but the extension is still installed, the bridge logs a warning and swallows the click.

## Error surfaces

| Condition | Where | Surfaced as |
|-----------|-------|-------------|
| `NotificationAction.id` empty | SDK proxy | rejected before IPC with `"NotificationAction requires a non-empty id"` |
| `NotificationAction.title` empty | SDK proxy | rejected with `"NotificationAction \"<id>\" requires a non-empty title"` |
| `NotificationAction.commandId` empty | SDK proxy + Rust validator | rejected with `"...requires a non-empty commandId"` |
| `args` not JSON-serialisable | SDK proxy | rejected with `"args are not JSON-serialisable"` |
| Extension missing `notifications:send` permission | Permission gate | IPC response `error: "Permission denied: notifications:send is required..."` |
| `commandId` unknown at click time | `NotificationActionBridge` | logged + swallowed |
| Extension disabled at click time | `NotificationActionBridge` | logged + swallowed |

## Wire format

| TS call | IPC type string | Permission |
|---------|-----------------|------------|
| `send({ title, actions })` | `asyar:api:notifications:send` | `notifications:send` |
| `dismiss(id)` | `asyar:api:notifications:dismiss` | `notifications:send` |
| `checkPermission()` | `asyar:api:notifications:checkPermission` | — (core) |
| `requestPermission()` | `asyar:api:notifications:requestPermission` | — (core) |

The Rust side emits `asyar:notification-action` on action click; this is an internal launcher event — extensions never subscribe to it directly.
