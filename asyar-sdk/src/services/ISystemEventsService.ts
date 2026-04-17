/**
 * Push-event service for OS-level system events: sleep, wake, lid
 * open/close, battery level, and AC/battery power source changes.
 *
 * Paired conceptually with `IPowerService` — opposite directions. The
 * power service instructs the OS (keep awake); the system-events service
 * observes it (did the OS sleep/wake/change power state).
 *
 * Requires the `system-events:read` manifest permission. Each call returns
 * a `Disposer` — invoke it to unsubscribe. The proxy ref-counts listeners
 * per event kind, so multiple `onSystemWake(cb)` calls trigger only one
 * subscribe RPC to the host.
 */

export type SystemEvent =
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'lid-open' }
  | { type: 'lid-close' }
  | { type: 'battery-level-changed'; percent: number }
  | { type: 'power-source-changed'; onBattery: boolean };

export type SystemEventKind = SystemEvent['type'];

export type Disposer = () => void;

export interface ISystemEventsService {
  onSystemSleep(cb: () => void): Disposer;
  onSystemWake(cb: () => void): Disposer;
  onLidOpen(cb: () => void): Disposer;
  onLidClose(cb: () => void): Disposer;
  onBatteryLevelChange(cb: (percent: number) => void): Disposer;
  onPowerSourceChange(cb: (onBattery: boolean) => void): Disposer;
}
