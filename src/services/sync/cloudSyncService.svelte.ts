import { profileService } from '../profile/profileService';
import { entitlementService } from '../auth/entitlementService.svelte';
import { logService } from '../log/logService';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';
import * as commands from '../../lib/ipc/commands';
import type { ISyncProvider, SyncChangeEvent, Unsubscribe } from '../profile/types';

/**
 * Steady-tick interval: 60 s per the delta-sync spec
 * (`docs/superpowers/specs/2026-05-03-delta-sync-cloud-sync.md`, "Sync
 * Triggering"). Exported so the tests can assert the constant rather than
 * pin a magic number twice.
 */
export const PERIODIC_SYNC_INTERVAL_MS = 60 * 1000;

/**
 * Per-item cloud sync (Layer 4a, delta-sync).
 *
 * One Tauri command — `sync_run` — drives a pull-then-push round-trip on
 * three triggers:
 *
 * 1. **Startup pull/push.** [`init`] calls [`syncNow`] once after auth and
 *    arms the periodic timer.
 * 2. **Steady tick.** Every 60 s while the launcher runs.
 * 3. **Local-change → early sync.** Each provider's `subscribeToChanges`
 *    callback drops into [`syncNow`] directly (no debounce — see
 *    `feedback_no_debounce`). The promise-singleton in `syncNow` collapses
 *    bursts of events into one in-flight HTTP round-trip.
 *
 * The TS layer is now a notifier + dispatcher: it hands the per-item
 * sources to Rust, lets Rust's hash-based dirty tracking decide what to
 * upload, and fans the server's pulled records back through each
 * provider's `applyItemUpsert` / `applyItemDelete`.
 */
class CloudSyncService {
  status = $state<'idle' | 'syncing' | 'error'>('idle');
  lastSyncedAt = $state<Date | null>(null);
  lastError = $state<string | null>(null);
  /**
   * Most recent [`commands.SyncRunReport`] response — useful for the
   * privacy / settings UI to render counts.
   */
  lastReport = $state<commands.SyncRunReport | null>(null);

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private currentRun: Promise<void> | null = null;
  private providerUnsubs: Unsubscribe[] = [];

  async init(): Promise<void> {
    if (!entitlementService.check('sync:settings')) return;

    await this.checkStatus().catch((err) => {
      logService.warn(`Cloud sync checkStatus failed: ${err}`);
    });

    // Background syncNow — do not await; errors flow through diagnostics
    // and `lastError`, but the caller of `init` shouldn't block on a
    // network round-trip.
    this.syncNow().catch((err) => {
      logService.warn(`Cloud sync initial run failed: ${err}`);
    });

    this.startPeriodicSync();
    this.subscribeToProviders();
  }

  startPeriodicSync(): void {
    if (this.syncTimer !== null) return;
    this.syncTimer = setInterval(() => {
      this.syncNow().catch((err) => {
        logService.warn(`Periodic cloud sync failed: ${err}`);
      });
    }, PERIODIC_SYNC_INTERVAL_MS);
  }

  stopPeriodicSync(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Full teardown — clears the periodic timer AND unsubscribes every
   * provider change handler that `init()` wired up. Use on logout, hot
   * reload, or any flow where the service should fully stop reacting.
   * Safe to call multiple times.
   */
  dispose(): void {
    this.stopPeriodicSync();
    for (const unsub of this.providerUnsubs) {
      try {
        unsub();
      } catch (err) {
        logService.warn(`Cloud sync: provider unsubscribe threw: ${err}`);
      }
    }
    this.providerUnsubs = [];
  }

  /**
   * Manually trigger one delta-sync round-trip. Replaces the old
   * `upload()` + `restore()` split — a single `sync_run` performs the
   * pull then the push.
   *
   * Concurrency: implemented as a promise-singleton — concurrent callers
   * all await the in-flight run. This collapses bursts of provider change
   * events into one HTTP round-trip without any extra state.
   */
  async syncNow(): Promise<void> {
    if (!entitlementService.check('sync:settings')) {
      throw new Error('sync:settings entitlement required');
    }
    if (this.currentRun) {
      return this.currentRun;
    }
    this.currentRun = this.runOnce().finally(() => {
      this.currentRun = null;
    });
    return this.currentRun;
  }

  async checkStatus(): Promise<void> {
    if (!entitlementService.check('sync:settings')) return;
    const statusResp = await commands.syncGetStatus();
    if (statusResp?.lastFullSyncAtIso) {
      this.lastSyncedAt = new Date(statusResp.lastFullSyncAtIso);
    } else {
      this.lastSyncedAt = null;
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Walk every entitlement-allowed provider's `exportItems()`, strip
   * declared `sensitiveFields`, hand the flat list to Rust, then fan the
   * server's response (uploaded ids + applied records + LWW warnings) back
   * through each provider's apply hooks.
   */
  private async runOnce(): Promise<void> {
    try {
      this.status = 'syncing';
      const sources = await this.collectSources();
      const report = await commands.syncRun(sources);
      if (!report) {
        // The Rust layer either failed or returned an error already
        // surfaced via invokeSafe; layer our own user-facing diagnostic on
        // top so the privacy UI surfaces a stable kind for "the run
        // didn't complete." `developerDetail` carries the user-facing
        // copy because the kind is frontend-namespaced and not in the
        // auto-generated DIAGNOSTIC_MESSAGES registry.
        await diagnosticsService.report({
          source: 'frontend',
          kind: 'sync.run-failed',
          severity: 'warning',
          retryable: true,
          developerDetail: 'Cloud sync run did not complete. Will retry on next tick.',
        });
        this.status = 'error';
        return;
      }

      await this.applyPullRecords(report.appliedRecords);
      this.surfaceWarnings(report);

      this.lastReport = report;
      this.lastSyncedAt = new Date();
      this.lastError = null;
      this.status = 'idle';
    } catch (err: unknown) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      logService.error(`Cloud sync run failed: ${err}`);
    }
  }

  /**
   * Walk every entitlement-allowed provider's `exportItems()` output,
   * strip sensitive fields, and produce the wire-friendly per-item list
   * the Tauri command expects.
   */
  private async collectSources(): Promise<commands.LocalItemSourceWire[]> {
    const allProviders = profileService.getProviders();
    const allowedProviders = allProviders.filter((p) => {
      if (p.syncTier === 'core') return true;
      return entitlementService.check('sync:ai-conversations');
    });

    const sources: commands.LocalItemSourceWire[] = [];
    for (const provider of allowedProviders) {
      const items = await provider.exportItems();
      const hasSensitiveFields = provider.sensitiveFields.length > 0;
      for (const item of items) {
        // We always stringify for the wire, so the deep-clone-via-
        // structuredClone path was both redundant AND buggy: Svelte 5
        // `$state` proxies (which several providers' content objects
        // are) throw `DataCloneError` when fed to `structuredClone`.
        // JSON-stringify works through proxies cleanly because it only
        // uses [[Get]] traps for enumerable string keys.
        //
        // Fast path: no sensitive fields → single stringify.
        // Strip path: stringify → parse → mutate → stringify.
        let contentJson: string;
        if (
          hasSensitiveFields &&
          item.content !== null &&
          typeof item.content === 'object'
        ) {
          const cloned = JSON.parse(JSON.stringify(item.content)) as unknown;
          provider.sensitiveFields.forEach((path) => stripField(cloned, path));
          contentJson = JSON.stringify(cloned);
        } else {
          contentJson = JSON.stringify(item.content);
        }
        sources.push({
          itemId: item.id,
          categoryId: item.categoryId,
          content: contentJson,
        });
      }
    }
    return sources;
  }

  /**
   * Fan each `appliedRecords` entry back through the matching provider's
   * `applyItemUpsert` / `applyItemDelete`. Records whose category does
   * not match a registered provider are logged and skipped — the journal
   * still records them, but the local store is untouched (this only
   * happens if the server has stale data for a category the launcher no
   * longer ships).
   */
  private async applyPullRecords(records: commands.AppliedRecord[]): Promise<void> {
    if (records.length === 0) return;
    const byId = new Map<string, ISyncProvider>();
    for (const p of profileService.getProviders()) {
      byId.set(p.id, p);
    }
    for (const record of records) {
      const provider = byId.get(record.categoryId);
      if (!provider) {
        logService.warn(
          `Cloud sync: no provider registered for categoryId='${record.categoryId}', skipping ${record.itemId}`,
        );
        continue;
      }
      try {
        if (record.deleted) {
          await provider.applyItemDelete(record.itemId);
        } else {
          const content =
            record.content === null ? null : (JSON.parse(record.content) as unknown);
          await provider.applyItemUpsert({
            id: record.itemId,
            categoryId: record.categoryId,
            content,
          });
        }
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        logService.warn(
          `Cloud sync: provider '${record.categoryId}' failed to apply ${record.itemId}: ${detail}`,
        );
        await diagnosticsService.report({
          source: 'frontend',
          kind: 'sync.apply-failed',
          severity: 'warning',
          retryable: false,
          context: {
            categoryId: record.categoryId,
            itemId: record.itemId,
          },
          developerDetail: detail,
        });
      }
    }
  }

  /**
   * Surface LWW conflicts and per-item push failures as user-facing
   * diagnostics. One aggregate warning per category — the privacy UI
   * shows the list, the bar shows the count.
   */
  private surfaceWarnings(report: commands.SyncRunReport): void {
    if (report.lwwWarnings.length > 0) {
      const count = report.lwwWarnings.length;
      diagnosticsService
        .report({
          source: 'frontend',
          kind: 'sync.item-overwritten',
          severity: 'warning',
          retryable: false,
          context: {
            count: String(count),
            itemIds: report.lwwWarnings.join(','),
          },
          developerDetail:
            count === 1
              ? '1 item was overwritten by a newer version from another device.'
              : `${count} items were overwritten by newer versions from another device.`,
        })
        .catch((err) => {
          logService.warn(`Cloud sync: failed to surface LWW diagnostic: ${err}`);
        });
    }
    if (report.failed.length > 0) {
      const detail = report.failed
        .map((f) => `${f.itemId} (${f.reason})`)
        .join(', ');
      logService.warn(`Cloud sync had ${report.failed.length} failed items: ${detail}`);
      // Mirror the failure into the diagnostic bar so the user sees it
      // alongside other sync warnings.
      diagnosticsService
        .report({
          source: 'frontend',
          kind: 'sync.apply-failed',
          severity: 'warning',
          retryable: true,
          context: {
            count: String(report.failed.length),
          },
          developerDetail: `${report.failed.length} item${report.failed.length === 1 ? '' : 's'} failed to upload: ${detail}`,
        })
        .catch((err) => {
          logService.warn(`Cloud sync: failed to surface push-failure diagnostic: ${err}`);
        });
    }
  }

  /**
   * Hook every registered provider's change emitter to [`syncNow`]. The
   * promise-singleton inside `syncNow` ensures bursts of events collapse
   * to one round-trip.
   */
  private subscribeToProviders(): void {
    // Detach any existing subs (defensive — init() should be called once
    // per launcher session, but if a host harness re-inits we don't want
    // duplicate handlers).
    for (const unsub of this.providerUnsubs) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.providerUnsubs = [];

    for (const provider of profileService.getProviders()) {
      try {
        const unsub = provider.subscribeToChanges((_ev: SyncChangeEvent) => {
          // Don't await — let the promise-singleton in syncNow coalesce.
          this.syncNow().catch((err) => {
            logService.warn(
              `Cloud sync: change-triggered run failed for ${provider.id}: ${err}`,
            );
          });
        });
        this.providerUnsubs.push(unsub);
      } catch (err: unknown) {
        logService.warn(
          `Cloud sync: provider ${provider.id} subscribeToChanges threw: ${err}`,
        );
      }
    }
  }
}

function stripField(obj: unknown, dotPath: string): void {
  if (typeof obj !== 'object' || obj === null) return;
  const parts = dotPath.split('.');
  let current: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]] as Record<string, unknown>;
    if (typeof current !== 'object' || current === null) return;
  }
  delete current[parts[parts.length - 1]];
}

export const cloudSyncService = new CloudSyncService();
