---
order: 7
---
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
| `intervalSeconds` | `integer` | ✅ | How often to call the command. Must be between **10** seconds and **86400** (24 hours). |

### Constraints

- `intervalSeconds` must be an integer in the range **[10, 86400]** (inclusive). Values outside this range are stripped at load time with a warning — the extension still loads, but the schedule is ignored.
- The command must have `resultType: "no-view"`. Scheduled commands cannot open a panel — there is no user interaction to display to.
- There is no `runOnStartup` option. The first tick fires one full interval after the extension is loaded.
- **Pick the largest interval that still meets your UX need.** A 10s poller wakes the CPU 6× per minute even when the user is idle. Use short intervals only when you have a concrete reason (e.g. Pomodoro minute-countdown, menu-bar status meter, sub-minute status poller). Prefer 60s+ for anything that could tolerate it.

### Why 10 seconds?

The floor is a semantic guard-rail, not a technical one. A tokio interval can fire far faster — the question is what `schedule` is *for*.

- **`schedule` is for recurring background work, not real-time streams.** If a command needs updates faster than every ~10s to feel correct (cursor tracking, live video, continuous telemetry), polling is the wrong primitive — it should be a subscription, an OS event source, or a push channel. The floor forces that architectural choice instead of letting it degrade into a busy loop labelled "schedule".
- **Every tick has non-trivial pipeline cost.** One tick traverses Rust `tokio::interval` → `AppHandle::emit` → TS host listener → (for Tier 2) iframe `postMessage` → extension `executeCommand`. Each hop is cheap in isolation, but the cost scales with `extensions × 1/interval`. A 10s floor caps the per-extension contribution at 0.1 Hz, leaving comfortable headroom for dozens of concurrently-scheduled extensions before the tick channel starts competing with user input.
- **Below ~10s, OS timer coalescing stops helping.** macOS and Linux both bunch short-deadline timers into grouped wakeups so the CPU can stay in deep idle states between them. The coalescing window scales with interval length; once intervals fall below the coalescer's leeway, every timer becomes its own wakeup and the CPU can't re-enter low-power C-states. 10s sits comfortably above that threshold on current platforms.
- **Sub-minute pollers still need to work.** Pomodoro minute-countdowns, menu-bar status meters, and "did the build go red?" notifiers all want updates inside a minute. The previous 60s floor forced those extensions to reinvent timers in JS — unsupervised, unrestartable, and invisible to Settings → Extensions. Lowering the floor pulls that work back into the platform's managed lifecycle.

The ceiling (86400s = 24h) is unchanged — anything longer belongs in cron or an external scheduler, not in the launcher process.

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
    this.network      = context.getService<INetworkService>('network');
    this.notifications = context.getService<INotificationService>('notifications');
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
✗ Command "fast-check": schedule.intervalSeconds must be between 10 and 86400 (got 5)
✗ Command "slow-sync": scheduled commands must have resultType "no-view"
```

Run `asyar validate` before every `asyar build` to catch these early.

---
