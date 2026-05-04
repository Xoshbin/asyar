import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Declare mocks first
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../lib/ipc/commands', () => ({
  syncRun: vi.fn(),
  syncGetStatus: vi.fn(),
}));

vi.mock('../profile/profileService', () => ({
  profileService: {
    getProviders: vi.fn(),
    getProviderById: vi.fn(),
  },
}));

vi.mock('../auth/entitlementService.svelte', () => ({
  entitlementService: {
    check: vi.fn(),
  },
}));

vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: {
    report: vi.fn(),
  },
}));

vi.mock('../log/logService', () => ({
  logService: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocks are declared.
import { cloudSyncService, PERIODIC_SYNC_INTERVAL_MS } from './cloudSyncService.svelte';
import * as commands from '../../lib/ipc/commands';
import { profileService } from '../profile/profileService';
import { entitlementService } from '../auth/entitlementService.svelte';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';
import type { ISyncProvider, SyncChangeEvent, Unsubscribe } from '../profile/types';

const okReport: commands.SyncRunReport = {
  uploaded: [],
  skipped: [],
  failed: [],
  appliedFromPull: [],
  appliedRecords: [],
  lwwWarnings: [],
  serverVersion: 0,
};

interface FakeProvider {
  id: string;
  syncTier: 'core' | 'extended';
  sensitiveFields: string[];
  exportItems: ReturnType<typeof vi.fn>;
  applyItemUpsert: ReturnType<typeof vi.fn>;
  applyItemDelete: ReturnType<typeof vi.fn>;
  subscribeToChanges: ReturnType<typeof vi.fn>;
  __emit?: (ev: SyncChangeEvent) => void;
}

/**
 * Build a hand-rolled fake provider that captures the change-callback so
 * tests can simulate provider events. Returns a minimal subset of the
 * `ISyncProvider` surface — the cloud sync service only touches the four
 * delta methods + sensitiveFields/syncTier metadata.
 */
function makeProvider(opts: {
  id: string;
  syncTier?: 'core' | 'extended';
  sensitiveFields?: string[];
  items?: Array<{ id: string; categoryId: string; content: unknown }>;
}): FakeProvider {
  const fp: FakeProvider = {
    id: opts.id,
    syncTier: opts.syncTier ?? 'core',
    sensitiveFields: opts.sensitiveFields ?? [],
    exportItems: vi.fn().mockResolvedValue(opts.items ?? []),
    applyItemUpsert: vi.fn().mockResolvedValue(undefined),
    applyItemDelete: vi.fn().mockResolvedValue(undefined),
    subscribeToChanges: vi.fn(
      (cb: (ev: SyncChangeEvent) => void): Unsubscribe => {
        fp.__emit = cb;
        return () => {
          fp.__emit = undefined;
        };
      },
    ),
  };
  return fp;
}

function asProviderList(...fakes: FakeProvider[]): ISyncProvider[] {
  // FakeProvider is structurally compatible with the subset of ISyncProvider
  // that cloudSyncService consumes; the cast keeps the test ergonomic.
  return fakes as unknown as ISyncProvider[];
}

describe('CloudSyncService (Task 4B delta-sync rewrite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudSyncService.status = 'idle';
    cloudSyncService.lastSyncedAt = null;
    cloudSyncService.lastError = null;
    cloudSyncService.lastReport = null;
    cloudSyncService.stopPeriodicSync();
    // Default: entitlement granted + status returns no last-sync time.
    vi.mocked(entitlementService.check).mockReturnValue(true);
    vi.mocked(commands.syncGetStatus).mockResolvedValue({
      cursor: 0,
      deviceId: 'dev-A',
      lastFullSyncAtIso: null,
      dirtyCount: 0,
      pendingTombstoneCount: 0,
    });
    vi.mocked(commands.syncRun).mockResolvedValue(okReport);
    vi.mocked(profileService.getProviders).mockReturnValue([]);
  });

  afterEach(() => {
    cloudSyncService.stopPeriodicSync();
  });

  // ── init() ────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('init_skips_when_sync_settings_entitlement_missing', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(false);

      await cloudSyncService.init();

      expect(commands.syncGetStatus).not.toHaveBeenCalled();
      expect(commands.syncRun).not.toHaveBeenCalled();
      expect(profileService.getProviders).not.toHaveBeenCalled();
    });

    it('init_pulls_then_pushes_then_starts_periodic_tick', async () => {
      vi.useFakeTimers();
      try {
        const provider = makeProvider({ id: 'snippets' });
        vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

        // init() awaits checkStatus, then fires syncNow as a background
        // promise, then arms the periodic timer.
        await cloudSyncService.init();
        expect(commands.syncGetStatus).toHaveBeenCalledTimes(1);

        // Drain the microtask chain that the background syncNow scheduled
        // (collectSources -> syncRun). advanceTimersByTimeAsync(0) lets
        // pending microtasks run under fake timers.
        await vi.advanceTimersByTimeAsync(0);
        expect(commands.syncRun).toHaveBeenCalledTimes(1);

        // Now advance the periodic tick.
        await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(0);
        expect(commands.syncRun).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('init subscribes to each provider exactly once', async () => {
      const a = makeProvider({ id: 'snippets' });
      const b = makeProvider({ id: 'shortcuts' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(a, b));

      await cloudSyncService.init();

      expect(a.subscribeToChanges).toHaveBeenCalledTimes(1);
      expect(b.subscribeToChanges).toHaveBeenCalledTimes(1);
    });
  });

  // ── syncNow() ─────────────────────────────────────────────────────────────

  describe('syncNow()', () => {
    it('manual_sync_now_calls_sync_run_immediately', async () => {
      const provider = makeProvider({
        id: 'snippets',
        items: [{ id: 's1', categoryId: 'snippets', content: { id: 's1', name: 'A' } }],
      });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

      await cloudSyncService.syncNow();

      expect(commands.syncRun).toHaveBeenCalledTimes(1);
      const sources = vi.mocked(commands.syncRun).mock.calls[0][0];
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({ itemId: 's1', categoryId: 'snippets' });
      expect(JSON.parse(sources[0].content)).toEqual({ id: 's1', name: 'A' });
      expect(cloudSyncService.status).toBe('idle');
      expect(cloudSyncService.lastSyncedAt).toBeInstanceOf(Date);
      expect(cloudSyncService.lastError).toBeNull();
    });

    it('throws when sync:settings entitlement is missing', async () => {
      vi.mocked(entitlementService.check).mockReturnValue(false);
      await expect(cloudSyncService.syncNow()).rejects.toThrow('sync:settings entitlement required');
    });

    it('stripField_strips_sensitive_fields_per_item', async () => {
      const provider = makeProvider({
        id: 'ai-settings',
        sensitiveFields: ['providers'],
        items: [
          {
            id: 'ai-settings',
            categoryId: 'ai-settings',
            content: { providers: { openai: { apiKey: 'sk-secret' } }, other: 'public' },
          },
        ],
      });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

      await cloudSyncService.syncNow();

      const sources = vi.mocked(commands.syncRun).mock.calls[0][0];
      const handed = JSON.parse(sources[0].content);
      expect(handed.providers).toBeUndefined();
      expect(handed.other).toBe('public');
    });

    it('serializes content backed by a Proxy (Svelte 5 $state) without DataCloneError', async () => {
      // structuredClone throws DataCloneError on Svelte 5's $state proxies;
      // collectSources() must use JSON-roundtrip semantics instead. We
      // simulate a runtime $state proxy with a Proxy whose [[Get]] trap
      // returns plain values (so JSON.stringify can serialize it) but
      // which structuredClone WOULD reject if anyone reintroduced it.
      const target = { text: 'hello', favorite: false };
      const proxiedContent = new Proxy(target, {
        get: (t, k) => Reflect.get(t, k),
        ownKeys: (t) => Reflect.ownKeys(t),
        getOwnPropertyDescriptor: (t, k) => Reflect.getOwnPropertyDescriptor(t, k),
      });

      const provider = makeProvider({
        id: 'clipboard',
        items: [{ id: 'i1', categoryId: 'clipboard', content: proxiedContent }],
      });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

      // Must not throw DataCloneError or any other clone-related error.
      await expect(cloudSyncService.syncNow()).resolves.toBeUndefined();

      const sources = vi.mocked(commands.syncRun).mock.calls[0][0];
      expect(sources).toHaveLength(1);
      expect(JSON.parse(sources[0].content)).toEqual({ text: 'hello', favorite: false });
    });

    it('skips extended-tier providers without sync:ai-conversations', async () => {
      vi.mocked(entitlementService.check).mockImplementation((e) => e === 'sync:settings');
      const core = makeProvider({ id: 'settings', syncTier: 'core' });
      const extended = makeProvider({ id: 'ai-conversations', syncTier: 'extended' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(core, extended));

      await cloudSyncService.syncNow();

      expect(core.exportItems).toHaveBeenCalled();
      expect(extended.exportItems).not.toHaveBeenCalled();
    });

    it('sync_run_failure_surfaces_diagnostic_warning', async () => {
      vi.mocked(commands.syncRun).mockResolvedValue(null);

      await cloudSyncService.syncNow();

      expect(cloudSyncService.status).toBe('error');
      expect(diagnosticsService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          kind: expect.any(String),
        }),
      );
    });

    it('reports a diagnostic when a provider exportItems throws', async () => {
      const provider = makeProvider({ id: 'snippets' });
      provider.exportItems = vi.fn().mockRejectedValue(new Error('boom'));
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

      await cloudSyncService.syncNow();

      expect(cloudSyncService.status).toBe('error');
      expect(cloudSyncService.lastError).toBe('boom');
    });

    // ── pull-application paths ────────────────────────────────────────────

    it('applies_pull_records_through_provider_applyItemUpsert', async () => {
      const provider = makeProvider({ id: 'snippets' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));
      vi.mocked(commands.syncRun).mockResolvedValue({
        ...okReport,
        appliedFromPull: ['s1'],
        appliedRecords: [
          {
            itemId: 's1',
            categoryId: 'snippets',
            content: JSON.stringify({ id: 's1', name: 'from-server' }),
            deleted: false,
          },
        ],
      });

      await cloudSyncService.syncNow();

      expect(provider.applyItemUpsert).toHaveBeenCalledWith({
        id: 's1',
        categoryId: 'snippets',
        content: { id: 's1', name: 'from-server' },
      });
    });

    it('applies_pull_deletes_through_provider_applyItemDelete', async () => {
      const provider = makeProvider({ id: 'snippets' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));
      vi.mocked(commands.syncRun).mockResolvedValue({
        ...okReport,
        appliedFromPull: ['ghost'],
        appliedRecords: [
          {
            itemId: 'ghost',
            categoryId: 'snippets',
            content: null,
            deleted: true,
          },
        ],
      });

      await cloudSyncService.syncNow();

      expect(provider.applyItemDelete).toHaveBeenCalledWith('ghost');
      expect(provider.applyItemUpsert).not.toHaveBeenCalled();
    });

    it('lww_warnings_surface_diagnostic', async () => {
      const provider = makeProvider({ id: 'snippets' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));
      vi.mocked(commands.syncRun).mockResolvedValue({
        ...okReport,
        lwwWarnings: ['conflict-1'],
      });

      await cloudSyncService.syncNow();

      expect(diagnosticsService.report).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          kind: 'sync.item-overwritten',
        }),
      );
    });

    it('updates lastReport after a successful run', async () => {
      vi.mocked(commands.syncRun).mockResolvedValue({
        ...okReport,
        uploaded: ['s1'],
        serverVersion: 7,
      });

      await cloudSyncService.syncNow();

      expect(cloudSyncService.lastReport).not.toBeNull();
      expect(cloudSyncService.lastReport?.uploaded).toEqual(['s1']);
      expect(cloudSyncService.lastReport?.serverVersion).toBe(7);
    });
  });

  // ── concurrency ────────────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('concurrent_sync_now_calls_collapse_to_one_in_flight_run', async () => {
      let resolveSync: ((value: commands.SyncRunReport | null) => void) | null = null;
      vi.mocked(commands.syncRun).mockImplementation(
        () =>
          new Promise<commands.SyncRunReport | null>((resolve) => {
            resolveSync = resolve;
          }),
      );

      const a = cloudSyncService.syncNow();
      const b = cloudSyncService.syncNow();
      const c = cloudSyncService.syncNow();

      // syncRun is called from inside an async runOnce — let the microtask
      // queue drain so the call is observable.
      await vi.waitFor(() => {
        expect(commands.syncRun).toHaveBeenCalledTimes(1);
      });

      resolveSync!(okReport);
      await Promise.all([a, b, c]);

      // Even after resolution, no second invocation is fired (no pending
      // change events accumulated).
      expect(commands.syncRun).toHaveBeenCalledTimes(1);
    });
  });

  // ── periodic tick ──────────────────────────────────────────────────────────

  describe('periodic sync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      cloudSyncService.stopPeriodicSync();
      vi.useRealTimers();
    });

    it('periodic_tick_calls_sync_run_every_60s', async () => {
      cloudSyncService.startPeriodicSync();

      // Advance one tick and let the runOnce microtask chain settle so the
      // syncRun invoke is observable.
      await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(commands.syncRun).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(commands.syncRun).toHaveBeenCalledTimes(2);

      // Sanity: 60 seconds, not the legacy 2-hour interval.
      expect(PERIODIC_SYNC_INTERVAL_MS).toBe(60_000);
    });

    it('startPeriodicSync(): does not start if already running', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      cloudSyncService.startPeriodicSync();
      cloudSyncService.startPeriodicSync();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });

    it('stopPeriodicSync(): clears the timer', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      cloudSyncService.startPeriodicSync();
      cloudSyncService.stopPeriodicSync();
      expect(clearIntervalSpy).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_INTERVAL_MS);
      expect(commands.syncRun).not.toHaveBeenCalled();
    });

    it('dispose(): unsubscribes provider change handlers AND stops the timer', async () => {
      const provider = makeProvider({ id: 'snippets' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

      await cloudSyncService.init();
      // Wait for the startup syncNow to settle so `commands.syncRun`'s
      // initial call doesn't leak into the post-dispose assertion.
      await vi.waitFor(() => {
        expect(commands.syncRun).toHaveBeenCalledTimes(1);
      });

      // Subscription was established during init() — `__emit` is set by
      // makeProvider's default subscribeToChanges impl when called.
      expect(provider.subscribeToChanges).toHaveBeenCalledTimes(1);
      expect(provider.__emit).toBeDefined();

      cloudSyncService.dispose();

      // Provider unsubscribe ran — makeProvider's unsub clears `__emit`.
      expect(provider.__emit).toBeUndefined();

      // Timer is cleared — periodic ticks no longer fire syncRun.
      vi.mocked(commands.syncRun).mockClear();
      await vi.advanceTimersByTimeAsync(PERIODIC_SYNC_INTERVAL_MS);
      expect(commands.syncRun).not.toHaveBeenCalled();
    });
  });

  // ── change subscription ────────────────────────────────────────────────────

  describe('provider change subscription', () => {
    it('provider_change_triggers_immediate_syncNow', async () => {
      const provider = makeProvider({ id: 'snippets' });
      vi.mocked(profileService.getProviders).mockReturnValue(asProviderList(provider));

      await cloudSyncService.init();

      // Wait for the startup syncNow to settle.
      await vi.waitFor(() => {
        expect(commands.syncRun).toHaveBeenCalledTimes(1);
      });

      // Simulate a local change event from the provider.
      provider.__emit?.({ type: 'upsert', itemId: 's1', categoryId: 'snippets' });

      await vi.waitFor(() => {
        expect(commands.syncRun).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ── checkStatus() ──────────────────────────────────────────────────────────

  describe('checkStatus()', () => {
    it('parses lastFullSyncAtIso from the new response shape', async () => {
      const now = new Date().toISOString();
      vi.mocked(commands.syncGetStatus).mockResolvedValue({
        cursor: 12,
        deviceId: 'dev-A',
        lastFullSyncAtIso: now,
        dirtyCount: 0,
        pendingTombstoneCount: 0,
      });

      await cloudSyncService.checkStatus();

      expect(cloudSyncService.lastSyncedAt).toEqual(new Date(now));
    });

    it('handles host failure (null response)', async () => {
      vi.mocked(commands.syncGetStatus).mockResolvedValue(null);

      await cloudSyncService.checkStatus();

      expect(cloudSyncService.lastSyncedAt).toBeNull();
    });
  });
});
