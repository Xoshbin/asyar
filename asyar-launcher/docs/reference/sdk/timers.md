### 8.28 `TimerService` — Persistent one-shot timers

**Runs in:** both worker and view. Fire callbacks dispatch to the command
handler registered on the worker — schedule timers from the worker and
register the matching `commands.onCommand(...)` handler there too.

**Permissions required:** `timers:schedule`, `timers:cancel`, `timers:list` — declared per method, not bundled.

Persist a "fire command `C` with args `A` at Unix-millis `T`" commitment across restarts. The host writes every scheduled timer to SQLite; if `fireAt` elapses while Asyar is quit, the timer fires (staggered) on the next launch.

**What this is not:** a recurring-timer service. For periodic work, use a manifest-declared `schedule` on a command ([scheduler docs](./command-service.md)). Timers are explicitly one-shot — each row fires once and then sits in the audit window before it's pruned.

```typescript
interface TimerDescriptor {
  timerId: string;
  extensionId: string;
  commandId: string;
  args: Record<string, unknown>;
  fireAt: number;     // Unix millis
  createdAt: number;  // Unix millis
}

interface ScheduleTimerOptions {
  commandId: string;                   // manifest command id
  fireAt: number;                      // Unix millis — must be > now
  args?: Record<string, unknown>;      // JSON-object only, defaults to {}
}

interface ITimerService {
  schedule(opts: ScheduleTimerOptions): Promise<string>; // returns timerId
  cancel(timerId: string): Promise<void>;
  list(): Promise<TimerDescriptor[]>;
}
```

**Manifest declaration:**

```json
{ "permissions": ["timers:schedule", "timers:cancel", "timers:list"] }
```

Declare only the verbs you use — a read-only inspection extension can declare `timers:list` alone, and a pure "schedule-and-forget" extension can skip `timers:list`.

---

#### Example: Pomodoro timer with a notification that reschedules a 5-minute snooze

```typescript
import type { INotificationService, ITimerService } from 'asyar-sdk';

const timers = context.getService<ITimerService>('timers');
const notifications = context.getService<INotificationService>('notifications');

export async function startPomodoro(): Promise<void> {
  const fireAt = Date.now() + 25 * 60 * 1000;
  await timers.schedule({ commandId: 'pomodoro.end', fireAt });
}

export async function pomodoroEnd(args: Record<string, unknown>): Promise<void> {
  await notifications.send({
    title: 'Pomodoro done',
    body: 'Take a break.',
    actions: [
      { id: 'snooze', title: 'Snooze 5 min', commandId: 'pomodoro.start-snooze' },
    ],
  });
}

export async function pomodoroStartSnooze(): Promise<void> {
  const fireAt = Date.now() + 5 * 60 * 1000;
  await timers.schedule({ commandId: 'pomodoro.end', fireAt, args: { fromSnooze: true } });
}
```

#### Example: One-off reminder at a human-parsed time

```typescript
import type { ITimerService } from 'asyar-sdk';

const timers = context.getService<ITimerService>('timers');

// "tomorrow at 9am" → parsed by your favourite natural-language date lib
const fireAt = parseDate('tomorrow at 9am').getTime();

await timers.schedule({
  commandId: 'reminder.fire',
  fireAt,
  args: { note: 'Call the vet about Rex', important: true },
});
```

#### Cancellation

```typescript
const timerId = await timers.schedule({ commandId: 'reminder.fire', fireAt: ... });
// ...later
await timers.cancel(timerId);  // NotFound if unknown, PermissionDenied if not yours
```

#### Listing your pending timers

```typescript
const pending = await timers.list();
// Only timers that haven't fired yet. Already-fired rows are retained in
// SQLite for 24 h (for audit) but they are not included here.
```

---

#### Persistence and catch-up semantics

* Rows are written to `extension_timers` in the launcher's `asyar_data.db` at schedule time, before `schedule` resolves.
* The scheduler polls once per second and emits the Tauri `asyar:timer:fire` event for each row whose `fire_at <= now`.
* Ordering is persist-first-emit-second: the row is marked `fired = 1` *before* the event is emitted, so a crash mid-emit cannot cause a duplicate fire on the next tick.
* At app launch any timer whose `fire_at` elapsed while the launcher was quit is caught up, staggered at 100 ms intervals (first 10 fire immediately), so 50 overdue timers don't slam the extension bridge in one tick.

#### Limitations

* **Granularity:** 1 second. Timers aren't meant for high-frequency work — use an in-process interval for that.
* **OS sleep:** if the machine was asleep past `fireAt`, the fire lands at wake rather than on-time. No wake-to-fire support.
* **Retention window:** fired rows are kept for 24 h and then pruned. A `cancel` of a long-fired id returns the same error shape as an unknown id.
* **Disable / uninstall clears timers:** disabling or uninstalling an extension drops all its scheduled timers. On re-enable, the user reschedules manually — otherwise fires into a torn-down iframe would be silent misfires.
* **Iframe mount dependency** *(important)***:** the fire event dispatches the command into the extension's iframe via `postMessage`. If the iframe is not currently mounted at fire time, the dispatch is dropped (though the row is still marked `fired`, so the next launch doesn't replay it).
  * **Always mounted:** extensions whose manifest declares `searchable: true` or any `commands[*].schedule` field — the launcher keeps their iframe loaded in the background so timers fire regardless of whether the launcher window is open.
  * **Only when launcher has been open:** extensions without either of the above get their iframe mounted lazily when the launcher is shown. Timers for these extensions fire reliably only after the user has opened the launcher since boot. If you rely on background firing, declare a (no-op) recurring `schedule` on any command to keep the iframe warm.

#### Comparison with the manifest-declared scheduler

|                          | `timers:*` API                        | manifest `commands[*].schedule`           |
|--------------------------|---------------------------------------|-------------------------------------------|
| Shape                    | One-shot, programmatic                | Recurring, declarative                    |
| Typical use              | Reminder, snooze, deadline            | "Sync every hour", "index every 10 min"   |
| Persistence              | SQLite row per timer; survives restart| Declared in manifest; no per-fire state   |
| Cancellation             | `timers.cancel(timerId)`              | Disable the extension                     |
| Runtime scheduling       | yes                                   | no                                        |
| Requires `searchable`?   | Effectively, for dormant dispatch     | Auto-mounts the iframe at boot            |

#### Error shapes

| Condition                                   | Error thrown by       |
|---------------------------------------------|-----------------------|
| `fireAt <= now`                             | `schedule`            |
| `args` is not a plain object                | `schedule`            |
| `timerId` unknown                           | `cancel`              |
| `timerId` owned by a different extension    | `cancel`              |
| Missing manifest permission                 | any                   |
