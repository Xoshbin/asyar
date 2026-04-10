# Background Scheduling

**No permission required.** The manifest declaration is the authorization.

Declarative recurring task execution. Declare `schedule` on any `no-view` command in `manifest.json` and Asyar calls your command handler at the configured interval — no JavaScript timers, no `setInterval`, no service calls. The platform owns the timer lifecycle entirely.

---

## Manifest schema

Add `schedule` to any command that should run on a timer:

```json
{
  "id": "com.example.deploy-monitor",
  "name": "Deploy Monitor",
  "version": "1.0.0",
  "description": "Checks deployment status every 5 minutes.",
  "author": "Jane Dev",
  "permissions": ["network", "notifications:send"],
  "commands": [
    {
      "id": "check-deploys",
      "name": "Check Deployments",
      "description": "Polls CI for new deployments",
      "resultType": "no-view",
      "schedule": {
        "intervalSeconds": 300
      }
    }
  ]
}
```

### `schedule` fields

| Field | Type | Required | Description |
|---|---|---|---|
| `intervalSeconds` | `integer` | ✅ | How often to call the command. Must be between **60** (1 minute) and **86400** (24 hours). |

### Constraints

- `intervalSeconds` must be an integer in the range **[60, 86400]** (inclusive). Values outside this range are stripped at load time with a warning — the extension still loads, but the schedule is ignored.
- The command must have `resultType: "no-view"`. Scheduled commands cannot open a panel — there is no user interaction to display to.
- There is no `runOnStartup` option. The first tick fires one full interval after the extension is loaded.

---

## Receiving tick calls

When the timer fires, Asyar calls your extension's `executeCommand` method:

```typescript
class MyExtension implements Extension {
  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'check-deploys') {
      const isScheduledTick = args?.scheduledTick === true;
      await this.checkDeployments();
    }
  }

  private async checkDeployments(): Promise<void> {
    // Your background logic here
  }
}
```

The `args` object includes `{ scheduledTick: true }` so you can tell the difference between a scheduled execution and a manual user invocation of the same command.

---

## Complete example — deploy monitor

```typescript
import type { Extension, ExtensionContext } from 'asyar-sdk';
import type { INetworkService, INotificationService } from 'asyar-sdk';

class DeployMonitor implements Extension {
  private network!: INetworkService;
  private notifications!: INotificationService;
  private lastSeenDeployId: string | null = null;

  async initialize(context: ExtensionContext): Promise<void> {
    this.network      = context.getService<INetworkService>('NetworkService');
    this.notifications = context.getService<INotificationService>('NotificationService');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  onUnload = null;

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'check-deploys') {
      await this.checkDeployments();
    }
  }

  private async checkDeployments(): Promise<void> {
    const response = await this.network.fetch('https://api.example.com/deployments/latest');
    if (!response.ok) return;

    const data = await response.json();
    const latestId = data.deploy?.id;

    if (latestId && latestId !== this.lastSeenDeployId) {
      this.lastSeenDeployId = latestId;
      await this.notifications.notify({
        title: 'New Deployment',
        body: `${data.deploy.environment}: ${data.deploy.commit_message}`,
      });
    }
  }
}

export default DeployMonitor;
```

The `lastSeenDeployId` field persists in memory between ticks. To persist it across restarts, use `StorageService.set()` / `StorageService.get()` instead — see [StorageService](./sdk/storage-service.md).

---

## Timer lifecycle

| Event | Timer behavior |
|---|---|
| Extension installed | Timer starts immediately after first `discover_extensions` scan. |
| Extension enabled | Timer starts. |
| Extension disabled | Timer stops. |
| Extension uninstalled | Timer stops and is removed permanently. |
| Asyar quits | All timers stop — tokio runtime shuts down. |
| Asyar restarts | `discover_extensions` runs on startup, restarting timers for all enabled extensions with scheduled commands. |

The platform skips the first tokio tick (fires immediately by default) — your command is first called one full interval after load, not instantly.

Scheduled commands run whether or not the launcher window is visible. They also run whether or not the user is currently interacting with the extension.

---

## Multiple scheduled commands

An extension can declare multiple scheduled commands, each with its own interval:

```json
"commands": [
  {
    "id": "fast-check",
    "name": "Fast Check",
    "description": "Runs every minute",
    "resultType": "no-view",
    "schedule": { "intervalSeconds": 60 }
  },
  {
    "id": "slow-sync",
    "name": "Slow Sync",
    "description": "Runs every hour",
    "resultType": "no-view",
    "schedule": { "intervalSeconds": 3600 }
  }
]
```

Each command gets its own independent timer keyed by `"{extensionId}::{commandId}"`.

---

## Viewing active schedules

Open **Settings → Extensions** and scroll to the **Scheduled Tasks** section. It lists every active timer: extension name, command name, interval (human-readable), and whether the timer is currently active or paused (extension disabled).

---

## How it works under the hood

```
Rust (tokio)                          TS host                    Extension (iframe)
─────────────────────────────────────────────────────────────────────────────────
Timer fires (tokio::time::interval)
emit "asyar:scheduler:tick"
  { extensionId, commandId }
                                      extensionManager listens
                                      handleScheduledTick():
                                        guard: extension enabled?
                                          no → skip
                                        commandService.executeCommand(
                                          "cmd_{extensionId}_{commandId}",
                                          { scheduledTick: true }
                                        )
                                        ─────────────────────────────────────►
                                        for Tier 2 (iframe) extensions:
                                          postMessage to iframe:
                                          { type: 'asyar:command:execute',
                                            payload: { commandId, args } }
                                                                             ExtensionBridge
                                                                             calls extension
                                                                             .executeCommand()
```

Timers live entirely in Rust (`tokio::time::interval`). The TS host only listens — it does not own any timer handles. When an extension is disabled, `stop_tasks_for_extension` aborts the tokio `JoinHandle`s; when re-enabled, new ones are spawned.

The host uses `commandService.executeCommand()` directly — not `handleCommandAction()` — to avoid the window-hiding side effect that `no-view` commands normally trigger when a user selects them.

---

## Iframe preloading for Tier 2 extensions

Installed (Tier 2) extensions run in sandboxed iframes. For a background command to execute, the iframe must be mounted. Asyar automatically mounts a hidden background iframe for any enabled Tier 2 extension that declares at least one scheduled command, regardless of whether the extension is also searchable.

You do not need to configure anything — this is handled automatically by the platform.

---

## Interaction with the compatibility system

Timers are only started for extensions whose [compatibility status](../explanation/lifecycle.md) is `Compatible`. If an extension is incompatible (wrong SDK version, wrong app version, wrong platform), its timers are never spawned even if it declares a schedule.

---

## SDK CLI validation

`asyar validate` checks schedule declarations and reports errors before you publish:

```
✗ Command "fast-check": schedule.intervalSeconds must be between 60 and 86400 (got 30)
✗ Command "slow-sync": scheduled commands must have resultType "no-view"
```

Run `asyar validate` before every `asyar build` to catch these early.

---
