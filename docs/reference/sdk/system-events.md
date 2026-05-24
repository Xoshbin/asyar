### 8.26 `SystemEventsService` — Observe OS state changes

**Runs in:** both worker and view. Subscriptions must register from the
worker so events fire even while the view is Dormant.

**Permission required:** `systemEvents:read` for every subscription.

Subscribe to OS-level system events — sleep, wake, lid open/close, battery
level changes, and AC-vs-battery power-source transitions. Paired
conceptually with [`PowerService`](./power-service.md) as its opposite
direction: `PowerService` *instructs* the OS (prevent sleep);
`SystemEventsService` *observes* it (the OS just slept / woke / changed
power source).

```typescript
type SystemEvent =
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'lid-open' }
  | { type: 'lid-close' }
  | { type: 'battery-level-changed'; percent: number }
  | { type: 'power-source-changed'; onBattery: boolean };

type Disposer = () => void;

interface ISystemEventsService {
  onSystemSleep(cb: () => void): Disposer;
  onSystemWake(cb: () => void): Disposer;
  onLidOpen(cb: () => void): Disposer;
  onLidClose(cb: () => void): Disposer;
  onBatteryLevelChange(cb: (percent: number) => void): Disposer;
  onPowerSourceChange(cb: (onBattery: boolean) => void): Disposer;
}
```

**Manifest declaration:**

```json
{ "permissions": ["systemEvents:read"] }
```

**Usage — pause background sync when running on battery:**

```typescript
const systemEvents = context.getService<ISystemEventsService>('systemEvents');

const dispose = systemEvents.onPowerSourceChange((onBattery) => {
  if (onBattery) pauseBackgroundSync();
  else resumeBackgroundSync();
});

// Later (e.g. on deactivate):
dispose();
```

**Usage — flush state before sleep, rehydrate after wake:**

```typescript
const d1 = systemEvents.onSystemSleep(() => flushToDisk());
const d2 = systemEvents.onSystemWake(() => reconnectWebsocket());
```

**Usage — react to low battery:**

```typescript
systemEvents.onBatteryLevelChange((percent) => {
  if (percent <= 10) showLowBatteryWarning();
});
```

### Subscription semantics

Each `on*` returns a `Disposer`. Invoke it to unsubscribe. The proxy
**ref-counts listeners per event kind** — calling `onSystemWake(cb1)` and
`onSystemWake(cb2)` issues only **one** `systemEvents:subscribe` RPC to the
host. When the last listener for that kind is disposed, one
`systemEvents:unsubscribe` RPC fires. This means you can sprinkle
subscriptions across a feature's lifecycle without worrying about stacking
up host-side subscribe calls.

Per-kind subscriptions are independent: `onSystemWake` and `onSystemSleep`
each get their own host subscription.

### Platform coverage

| Event                    | macOS                                                  | Linux | Windows |
|--------------------------|--------------------------------------------------------|-------|---------|
| `sleep` / `wake`         | `IORegisterForSystemPower` on a CFRunLoop thread       | logind `org.freedesktop.login1.Manager.PrepareForSleep(bool)` signal | `WM_POWERBROADCAST` — `PBT_APMSUSPEND` / `PBT_APMRESUME*` |
| `lid-open` / `lid-close` | Poll `AppleClamshellState` from IORegistry every 2s    | UPower `LidIsClosed` property via DBus `PropertiesChanged` | `GUID_LIDSWITCH_STATE_CHANGE` via `RegisterPowerSettingNotification` |
| `battery-level-changed`  | Poll `IOPSCopyPowerSourcesInfo` every 30s, dispatch on change | UPower `Percentage` property on the Battery device via `PropertiesChanged` (deduped at integer granularity) | `GUID_BATTERY_PERCENTAGE_REMAINING` via `RegisterPowerSettingNotification` (deduped at integer granularity) |
| `power-source-changed`   | Poll `IOPSCopyPowerSourcesInfo` every 30s, dispatch on change | UPower `OnBattery` property via `PropertiesChanged` | `GUID_ACDC_POWER_SOURCE` via `RegisterPowerSettingNotification` |

All three platforms dispatch into the same `SystemEventsHub` from a dedicated
watcher thread so the Tauri runtime stays free of blocking system calls.

#### Per-source degradation

On Linux each DBus source (logind, UPower root, UPower display battery)
runs on its own blocking thread with its own `zbus::blocking::Connection`.
If any single source fails to start — the machine has no UPower (headless
container, minimal distro), no battery device (desktop PC), or the lid
switch isn't exposed — the watcher logs a single warning for that source
and keeps the others running. Sleep/wake via logind still fires even when
UPower is absent; lid events still fire even when no battery device is
present.

On Windows the four `RegisterPowerSettingNotification` registrations are
independent: any single registration failure logs a warning and leaves the
other sources wired up. `WM_POWERBROADCAST` sleep/wake events continue to
fire regardless — they are delivered by the OS to every message-pump
window and don't require the power-setting registrations.

Despite the per-platform source coverage, treat the service as best-effort
at the call site. A machine without a battery will never emit
`battery-level-changed`; a desktop without a lid switch will never emit
`lid-*`. Design each `on*` subscription so the feature degrades gracefully
when no events arrive.

### Edge cases

- **Desktops without a battery** (most iMacs, Mac Studios, desktop PCs):
  none of the three platforms will ever fire `battery-level-changed` or
  `power-source-changed`. On macOS `IOPSCopyPowerSourcesList` returns an
  empty list; on Linux UPower exposes no `Type == 2` device; on Windows
  `RegisterPowerSettingNotification` registers successfully but the OS
  never delivers `GUID_BATTERY_PERCENTAGE_REMAINING` / `GUID_ACDC_POWER_SOURCE`.
  Treat the absence of events as "power state unknown."
- **Debouncing battery ticks:** All three platforms dedupe at integer
  percent granularity. macOS polls every 30s and only dispatches on change;
  Linux rounds fractional UPower updates to an integer before comparing;
  Windows stores the last-seen percent per window and suppresses repeats.
  Expect a burst only during discharge/recharge; a fully charged machine
  can go hours without a single event.
- **`lid-open` / `lid-close` on desktops** never fires. The clamshell key
  is absent on macOS IORegistry; UPower has no `LidIsClosed` on desktops;
  Windows' `GUID_LIDSWITCH_STATE_CHANGE` simply never fires.
- **`sleep` callback is not a lifecycle hook.** On macOS you get only a
  few seconds after `kIOMessageSystemWillSleep` before the system
  acknowledges and powers down. logind's `PrepareForSleep(true)` and
  Windows' `PBT_APMSUSPEND` arrive with similarly tight deadlines. Keep
  the callback fast — flush critical state, don't start new work.
- **Permission scope.** `systemEvents:read` is a single permission that
  unlocks all six event kinds. There's no per-kind granularity.

### Lifecycle

| Event                  | What happens to your subscriptions |
|------------------------|------------------------------------|
| Extension uninstall    | All subscriptions for this extension are removed automatically. |
| Extension disable      | All subscriptions for this extension are removed via the uninstall cleanup path. |
| Iframe reload          | In-flight subscriptions are dropped; the SDK proxy re-subscribes on the next `on*` call after reload. |
| Launcher process exit  | OS reclaims all watcher resources.                                |

### Wire contract

- Subscribe RPC: `asyar:api:systemEvents:subscribe` with payload
  `{ eventTypes: string[] }` → returns an opaque UUID subscription id.
- Unsubscribe RPC: `asyar:api:systemEvents:unsubscribe` with payload
  `{ subscriptionId: string }`.
- Push messages: `asyar:event:system-event:push` with payload matching the
  `SystemEvent` union (`type` discriminator in kebab-case, camelCase
  fields). Dispatched from Rust's `SystemEventsHub` via
  `app_handle.emit("asyar:system-event", {extensionId, event})` and
  forwarded to the target iframe by the host's `systemEventsBridge`.

> **Pro Tip:** To react to "connected" / "disconnected" network state,
> combine `onPowerSourceChange` (battery might mean offline soon) with your
> own connectivity probe — `SystemEventsService` does not emit network
> events.

---
