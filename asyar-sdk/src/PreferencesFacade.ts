import { PreferencesServiceProxy } from "./services/PreferencesServiceProxy";

/**
 * A frozen snapshot of an extension's effective preferences, taken at
 * extension boot. Extension-level preferences are flat keys on this object;
 * command-level preferences live under `commands[commandId]`.
 *
 * This snapshot is NOT live. When the user edits preferences in Settings,
 * the launcher reloads the extension and a fresh context is created.
 * Extensions should not cache `context.preferences` across reloads.
 */
export interface PreferencesSnapshot {
  [key: string]: unknown;
  commands: { [commandId: string]: { [key: string]: unknown } };
}

export function buildFrozenSnapshot(bundle: {
  extension: Record<string, unknown>;
  commands: Record<string, Record<string, unknown>>;
}): PreferencesSnapshot {
  const snapshot = { ...bundle.extension, commands: {} } as Record<string, unknown> & { commands: Record<string, Readonly<Record<string, unknown>>> };
  for (const [cmdId, prefs] of Object.entries(bundle.commands ?? {})) {
    snapshot.commands[cmdId] = Object.freeze({ ...prefs });
  }
  Object.freeze(snapshot.commands);
  return Object.freeze(snapshot) as PreferencesSnapshot;
}

/**
 * Unified preferences surface on `context.preferences`. Exposes the
 * frozen snapshot at `.values` (boot-time + push-updated) alongside
 * IPC-backed mutation methods (`set`, `reset`, `refresh`).
 */
export class PreferencesFacade {
  public values: PreferencesSnapshot = Object.freeze({
    commands: Object.freeze({}),
  }) as PreferencesSnapshot;
  private readonly proxy = new PreferencesServiceProxy();

  /** @internal */
  _setValues(snapshot: PreferencesSnapshot): void {
    this.values = snapshot;
  }

  /** @internal */
  _setExtensionId(id: string): void {
    this.proxy.setExtensionId(id);
  }

  set(scope: string, key: string, value: unknown): Promise<void> {
    return this.proxy.set(scope, key, value);
  }

  reset(scope: string): Promise<void> {
    return this.proxy.reset(scope);
  }

  async refresh(): Promise<PreferencesSnapshot> {
    const fresh = await this.proxy.getAll();
    this._setValues(buildFrozenSnapshot(fresh));
    return this.values;
  }
}
