// Dev-only inspector store. Module singleton with Svelte 5 runes.
//
// Module-level gating: every public method no-ops unless
// `import.meta.env.DEV`, so even if this file is imported by accident in
// production (it shouldn't be — the InspectorShell is dynamic-imported
// inside a DEV-gated block), the runtime cost is zero.
//
// The store owns: open state, selected extension, active tab, the latest
// runtime snapshot (per `extensionId:role` key), and — added in later
// steps — state values, subscriptions, event/RPC/IPC ring buffers.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import extensionManager from '../extension/extensionManager.svelte';

export type ContextRoleWire = 'worker' | 'view';

export type RuntimeState =
  | 'dormant'
  | 'mounting'
  | 'ready'
  | 'degraded'
  | 'unknown';

export interface RuntimeEntry {
  extensionId: string;
  role: ContextRoleWire;
  state: RuntimeState;
  mailboxLen: number;
  mountToken?: number;
  strikes?: number;
  updatedAt: number;
}

export interface StateEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface SubscriptionSummary {
  key: string;
  role: ContextRoleWire;
  installedAt: number;
  listenerCount: number;
}

interface SnapshotRow {
  extension_id: string;
  role: ContextRoleWire;
  state: string;
  mailbox_len: number;
}

const RUNTIME_POLL_MS = 1000;
const SUBS_POLL_MS = 1000;
const EVENT_RING_CAP = 250;

/** Tauri event channels the inspector taps for the Events panel. */
const TAPPED_EVENTS = [
  'asyar:iframe:mount',
  'asyar:iframe:unmount',
  'asyar:iframe:degraded',
  'asyar:iframe:recovered',
  'asyar:state-changed',
  'asyar:state-rpc-reply',
  'asyar:system-event',
  'asyar:app-event',
  'asyar:tray-item-click',
] as const;

export interface EventRow {
  id: number;
  timestamp: number;
  eventName: string;
  extensionId: string | null;
  payload: unknown;
}

export type RpcPhase = 'request' | 'resolved' | 'rejected' | 'timeout';

export interface RpcTrace {
  correlationId: string;
  id?: string;
  phase: RpcPhase;
  payload?: unknown;
  result?: unknown;
  error?: string;
  timeoutMs?: number;
  elapsedMs?: number;
  startedAt: number;
  updatedAt: number;
}

export type IpcPhase = 'invoke' | 'response';

export interface IpcTrace {
  seq: number;
  messageId: string;
  command: string;
  phase: IpcPhase;
  payload?: unknown;
  result?: unknown;
  error?: string;
  elapsedMs?: number;
  timestamp: number;
}

const RPC_RING_CAP = 250;
const IPC_RING_CAP = 250;

function keyOf(extensionId: string, role: ContextRoleWire): string {
  return `${extensionId}:${role}`;
}

function coerceState(raw: string): RuntimeState {
  const s = raw.toLowerCase();
  if (s === 'dormant' || s === 'mounting' || s === 'ready' || s === 'degraded') return s;
  return 'unknown';
}

class InspectorStore {
  // ── UI state ─────────────────────────────────────────────────────────────
  isOpen = $state(false);
  selectedExtensionId = $state<string | null>(null);
  activeTab = $state<'runtime' | 'state' | 'subscriptions' | 'events' | 'rpc' | 'ipc' | 'help'>(
    'runtime',
  );

  // ── Runtime snapshots, keyed by `extensionId:role` ───────────────────────
  runtimeMap = $state<Record<string, RuntimeEntry>>({});

  // ── Launcher-brokered state, keyed by extensionId. Populated on demand
  //    when a State tab is focused; live-patched by the state-changed tap.
  stateByExt = $state<Record<string, StateEntry[]>>({});

  // ── Subscription registry snapshot, keyed by extensionId. Polled 1Hz
  //    while the Subscriptions tab is visible for any selected extension.
  subsByExt = $state<Record<string, SubscriptionSummary[]>>({});

  // ── Per-extension ring buffer of observed Tauri events. Capped at
  //    `EVENT_RING_CAP` per extension. Always collects — Pause in the UI
  //    is a display-freeze, not a recording gate.
  eventsByExt = $state<Record<string, EventRow[]>>({});
  #eventSeq = 0;

  // ── RPC trace table: one row per correlationId, updated across phases.
  //    Keyed `extensionId → Map<correlationId, RpcTrace>`. Exposed as a
  //    plain object so Svelte's reactivity graph picks up changes cleanly.
  rpcByExt = $state<Record<string, Record<string, RpcTrace>>>({});

  // ── IPC log: 250-row ring per extension, append-only observations.
  ipcByExt = $state<Record<string, IpcTrace[]>>({});
  #ipcSeq = 0;

  // ── Subscription/listener cleanup wired from start()/stop() ─────────────
  #unlisteners: UnlistenFn[] = [];
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #subsPollTimer: ReturnType<typeof setInterval> | null = null;
  #started = false;

  toggle(): void {
    this.isOpen = !this.isOpen;
  }

  selectExtension(id: string | null): void {
    this.selectedExtensionId = id;
  }

  setActiveTab(tab: InspectorStore['activeTab']): void {
    this.activeTab = tab;
  }

  /** Runtime entries filtered to the selected extension. */
  entriesForSelected(): RuntimeEntry[] {
    const id = this.selectedExtensionId;
    if (!id) return [];
    return Object.values(this.runtimeMap).filter((e) => e.extensionId === id);
  }

  /**
   * Wire up data streams. Idempotent — safe to call from multiple panel
   * mounts. Data stays live until `stop()`. Safe to call in non-DEV:
   * no-ops and bails.
   */
  async start(): Promise<void> {
    if (!import.meta.env.DEV) return;
    if (this.#started) return;
    this.#started = true;

    await this.refreshRuntimeSnapshot();
    this.#pollTimer = setInterval(() => {
      void this.refreshRuntimeSnapshot();
    }, RUNTIME_POLL_MS);

    this.#subsPollTimer = setInterval(() => {
      const id = this.selectedExtensionId;
      if (!id) return;
      void this.refreshSubscriptions(id);
    }, SUBS_POLL_MS);

    const unsubMount = await listen<{
      extensionId: string;
      mountToken?: number;
      role?: ContextRoleWire;
    }>('asyar:iframe:mount', (event) => {
      const p = event.payload;
      if (!p?.extensionId || !p.role) return;
      this.#patchEntry(p.extensionId, p.role, {
        state: 'mounting',
        mountToken: p.mountToken,
      });
    });

    const unsubUnmount = await listen<{
      extensionId: string;
      role?: ContextRoleWire;
      reason?: string;
    }>('asyar:iframe:unmount', (event) => {
      const p = event.payload;
      if (!p?.extensionId) return;
      const roles: ContextRoleWire[] = p.role ? [p.role] : ['worker', 'view'];
      for (const r of roles) {
        this.#patchEntry(p.extensionId, r, { state: 'dormant', mailboxLen: 0 });
      }
    });

    const unsubDegraded = await listen<{
      extensionId: string;
      strikes?: number;
      role?: ContextRoleWire;
    }>('asyar:iframe:degraded', (event) => {
      const p = event.payload;
      if (!p?.extensionId || !p.role) return;
      this.#patchEntry(p.extensionId, p.role, {
        state: 'degraded',
        strikes: p.strikes,
      });
    });

    const unsubStateChanged = await listen<{
      extensionId: string;
      key: string;
      value: unknown;
      role?: ContextRoleWire;
    }>('asyar:state-changed', (event) => {
      const p = event.payload;
      if (!p?.extensionId) return;
      this.#patchState(p.extensionId, p.key, p.value);
    });

    this.#unlisteners.push(unsubMount, unsubUnmount, unsubDegraded, unsubStateChanged);

    for (const channel of TAPPED_EVENTS) {
      const un = await listen<unknown>(channel, (event) => {
        this.recordEvent(channel, event.payload);
      });
      this.#unlisteners.push(un);
    }
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    if (this.#subsPollTimer) {
      clearInterval(this.#subsPollTimer);
      this.#subsPollTimer = null;
    }
    for (const un of this.#unlisteners) {
      try {
        un();
      } catch (err) {
        logService.debug(`[dev-inspector] unlisten failed: ${err}`);
      }
    }
    this.#unlisteners = [];
  }

  async refreshRuntimeSnapshot(): Promise<void> {
    if (!import.meta.env.DEV) return;
    try {
      const rows = await invoke<SnapshotRow[]>('get_extension_runtime_snapshot');
      const next: Record<string, RuntimeEntry> = {};
      const now = Date.now();
      for (const row of rows) {
        const key = keyOf(row.extension_id, row.role);
        const prev = this.runtimeMap[key];
        next[key] = {
          extensionId: row.extension_id,
          role: row.role,
          state: coerceState(row.state),
          mailboxLen: row.mailbox_len,
          mountToken: prev?.mountToken,
          strikes: prev?.strikes,
          updatedAt: now,
        };
      }
      this.runtimeMap = next;
    } catch (err) {
      logService.debug(`[dev-inspector] snapshot invoke failed: ${err}`);
    }
  }

  async forceRemountWorker(extensionId: string): Promise<void> {
    if (!import.meta.env.DEV) return;
    try {
      const manifest = extensionManager.getManifestById(extensionId) as
        | { background?: { main?: string } }
        | undefined;
      const hasBackgroundMain = !!manifest?.background?.main;
      await invoke('force_remount_worker', {
        extensionId,
        hasBackgroundMain,
      });
    } catch (err) {
      logService.debug(`[dev-inspector] force_remount_worker failed: ${err}`);
    }
  }

  async refreshState(extensionId: string): Promise<void> {
    if (!import.meta.env.DEV) return;
    try {
      const rows = await invoke<
        Array<{ key: string; value: unknown; updatedAt: number }>
      >('state_get_all', { extensionId });
      this.stateByExt = {
        ...this.stateByExt,
        [extensionId]: rows.map((r) => ({
          key: r.key,
          value: r.value,
          updatedAt: r.updatedAt,
        })),
      };
    } catch (err) {
      logService.debug(`[dev-inspector] state_get_all failed: ${err}`);
    }
  }

  async refreshSubscriptions(extensionId: string): Promise<void> {
    if (!import.meta.env.DEV) return;
    try {
      const rows = await invoke<
        Array<{ key: string; role: ContextRoleWire; installedAt: number; listenerCount: number }>
      >('state_get_subscriptions', { extensionId });
      this.subsByExt = {
        ...this.subsByExt,
        [extensionId]: rows.map((r) => ({
          key: r.key,
          role: r.role,
          installedAt: r.installedAt,
          listenerCount: r.listenerCount,
        })),
      };
    } catch (err) {
      logService.debug(`[dev-inspector] state_get_subscriptions failed: ${err}`);
    }
  }

  /**
   * Append a Tauri event observation to the per-extension ring buffer.
   * Events whose payload has no `extensionId` are skipped — the inspector
   * is scoped per-extension, and bare events (e.g. `asyar:extension-update:tick`)
   * have nothing to attach to.
   *
   * Exposed (not private) so the Events panel's test harness and the SDK
   * tap bridge can both feed observations through the same normalisation
   * + ring-buffer discipline.
   */
  recordEvent(eventName: string, payload: unknown): void {
    const extensionId = this.#extractExtensionId(payload);
    if (!extensionId) return;
    const row: EventRow = {
      id: this.#eventSeq++,
      timestamp: Date.now(),
      eventName,
      extensionId,
      payload,
    };
    const prev = this.eventsByExt[extensionId] ?? [];
    const next = [...prev, row];
    if (next.length > EVENT_RING_CAP) next.splice(0, next.length - EVENT_RING_CAP);
    this.eventsByExt = { ...this.eventsByExt, [extensionId]: next };
  }

  clearEvents(extensionId: string): void {
    if (!this.eventsByExt[extensionId]) return;
    const next = { ...this.eventsByExt };
    delete next[extensionId];
    this.eventsByExt = next;
  }

  /**
   * Ingest an `asyar:dev:rpc-log` observation from the SDK's `emitRpcLog`.
   * Aggregates by correlationId so a request → resolved flow shows up as
   * one row going from Pending to Resolved. Unknown correlation ids are
   * created on the fly — the inspector may attach mid-flight.
   */
  recordRpcLog(extensionId: string, log: {
    phase: RpcPhase;
    id?: string;
    correlationId: string;
    payload?: unknown;
    result?: unknown;
    error?: string;
    timeoutMs?: number;
    elapsedMs?: number;
    timestamp: number;
  }): void {
    const byId = this.rpcByExt[extensionId] ?? {};
    const prev = byId[log.correlationId];
    const merged: RpcTrace = {
      correlationId: log.correlationId,
      id: log.id ?? prev?.id,
      phase: log.phase,
      payload: prev?.payload ?? log.payload,
      result: log.result ?? prev?.result,
      error: log.error ?? prev?.error,
      timeoutMs: log.timeoutMs ?? prev?.timeoutMs,
      elapsedMs: log.elapsedMs ?? prev?.elapsedMs,
      startedAt: prev?.startedAt ?? log.timestamp,
      updatedAt: log.timestamp,
    };

    let entries = { ...byId, [log.correlationId]: merged };

    // Cap: once settled rows outnumber the cap, drop the oldest settled
    // entries first (never drop in-flight requests).
    const keys = Object.keys(entries);
    if (keys.length > RPC_RING_CAP) {
      const settled = keys
        .map((k) => entries[k])
        .filter((r) => r.phase !== 'request')
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const drop = keys.length - RPC_RING_CAP;
      for (let i = 0; i < drop && i < settled.length; i++) {
        const trimmed = { ...entries };
        delete trimmed[settled[i].correlationId];
        entries = trimmed;
      }
    }

    this.rpcByExt = { ...this.rpcByExt, [extensionId]: entries };
  }

  /**
   * Ingest an `asyar:dev:ipc-log` observation. Always appends — the ring
   * buffer handles cap.
   */
  recordIpcLog(extensionId: string, log: {
    phase: IpcPhase;
    command?: string;
    payload?: unknown;
    result?: unknown;
    error?: string;
    messageId: string;
    elapsedMs?: number;
    timestamp: number;
  }): void {
    const row: IpcTrace = {
      seq: this.#ipcSeq++,
      messageId: log.messageId,
      command: log.command ?? '(unknown)',
      phase: log.phase,
      payload: log.payload,
      result: log.result,
      error: log.error,
      elapsedMs: log.elapsedMs,
      timestamp: log.timestamp,
    };
    const prev = this.ipcByExt[extensionId] ?? [];
    const next = [...prev, row];
    if (next.length > IPC_RING_CAP) next.splice(0, next.length - IPC_RING_CAP);
    this.ipcByExt = { ...this.ipcByExt, [extensionId]: next };
  }

  clearRpc(extensionId: string): void {
    if (!this.rpcByExt[extensionId]) return;
    const next = { ...this.rpcByExt };
    delete next[extensionId];
    this.rpcByExt = next;
  }

  clearIpc(extensionId: string): void {
    if (!this.ipcByExt[extensionId]) return;
    const next = { ...this.ipcByExt };
    delete next[extensionId];
    this.ipcByExt = next;
  }

  #extractExtensionId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as { extensionId?: unknown; extension_id?: unknown };
    if (typeof p.extensionId === 'string') return p.extensionId;
    if (typeof p.extension_id === 'string') return p.extension_id;
    return null;
  }

  #patchState(extensionId: string, key: string, value: unknown): void {
    const prev = this.stateByExt[extensionId] ?? [];
    const now = Date.now();
    let found = false;
    const next: StateEntry[] = prev.map((row) => {
      if (row.key === key) {
        found = true;
        return { key, value, updatedAt: now };
      }
      return row;
    });
    if (!found) next.push({ key, value, updatedAt: now });
    this.stateByExt = { ...this.stateByExt, [extensionId]: next };
  }

  #patchEntry(
    extensionId: string,
    role: ContextRoleWire,
    patch: Partial<RuntimeEntry>,
  ): void {
    const key = keyOf(extensionId, role);
    const prev = this.runtimeMap[key];
    const merged: RuntimeEntry = {
      extensionId,
      role,
      state: patch.state ?? prev?.state ?? 'unknown',
      mailboxLen: patch.mailboxLen ?? prev?.mailboxLen ?? 0,
      mountToken: patch.mountToken ?? prev?.mountToken,
      strikes: patch.strikes ?? prev?.strikes,
      updatedAt: Date.now(),
    };
    this.runtimeMap = { ...this.runtimeMap, [key]: merged };
  }
}

export const inspectorStore: InspectorStore = new InspectorStore();
