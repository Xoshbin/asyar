### 8.26 `SystemEventsService` — Observe OS state changes

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
| `sleep` / `wake`         | `IORegisterForSystemPower` on a CFRunLoop thread       | *not yet implemented — logind PrepareForSleep signal planned* | *not yet implemented — WM_POWERBROADCAST planned* |
| `lid-open` / `lid-close` | Poll `AppleClamshellState` from IORegistry every 2s    | *not yet implemented — UPower LidIsClosed planned* | *not yet implemented — GUID_LIDSWITCH_STATE_CHANGE planned* |
| `battery-level-changed`  | Poll `IOPSCopyPowerSourcesInfo` every 30s, dispatch on change | *not yet implemented — UPower PropertiesChanged planned* | *not yet implemented — GUID_BATTERY_PERCENTAGE_REMAINING planned* |
| `power-source-changed`   | Poll `IOPSCopyPowerSourcesInfo` every 30s, dispatch on change | *not yet implemented — UPower PropertiesChanged planned* | *not yet implemented — GUID_ACDC_POWER_SOURCE planned* |

On Linux and Windows the watcher currently logs a warning at startup and
then stays idle — subscriptions still succeed, they just never fire. Do
**not** assume a subscription guarantees callback delivery; treat the
service as best-effort, and design your feature to degrade gracefully when
no events arrive.

### Edge cases

- **Desktops without a battery** (most iMacs, Mac Studios, desktop PCs):
  `IOPSCopyPowerSourcesList` returns an empty list on macOS; no battery or
  power-source events ever fire. Treat the absence of events as "power
  state unknown."
- **Debouncing battery ticks:** The macOS poller dispatches only when the
  percent changes. Expect a burst only during discharge/recharge; a fully
  charged machine can go hours without a single event.
- **`lid-open` / `lid-close` on desktops** never fires. `AppleClamshellState`
  is only present on laptops.
- **`sleep` callback is not a lifecycle hook.** macOS gives apps only a few
  seconds after `kIOMessageSystemWillSleep` before it acknowledges and
  powers down. Keep the callback fast — flush critical state, don't start
  new work.
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
