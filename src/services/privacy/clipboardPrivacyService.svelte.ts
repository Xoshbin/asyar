import { load, type Store } from '@tauri-apps/plugin-store';
import {
  clipboardPrivacyClassify,
  clipboardPrivacyGetDefaultDenylist,
  clipboardPrivacyGetSessionStats,
  clipboardPrivacyGetUserDenylist,
  clipboardPrivacySetUserDenylist,
  type ClipboardPrivacyClassification,
} from '../../lib/ipc/commands';
import { logService } from '../log/logService';

/**
 * Persistent storage for the user denylist.
 *
 * The Rust [`UserDenylist`] state is in-memory only — restoring it across
 * launches is the launcher's responsibility. We use a dedicated store file
 * so the denylist is independent of the larger `settings.dat` and survives
 * settings resets.
 */
const STORE_FILE = 'clipboard-privacy.dat';
const STORE_KEY = 'userDenylist';

/**
 * Reactive wrapper around the host-side capture-time privacy filter.
 * The filter itself runs in Rust ([`clipboard_privacy::classify`]); this
 * service exposes the result + denylist to Svelte components and gates the
 * clipboard capture pipeline before persistence.
 */
export class ClipboardPrivacyService {
  defaultDenylist = $state<string[]>([]);
  userDenylist = $state<string[]>([]);
  sessionStats = $state<Record<string, number>>({});

  private store: Store | null = null;

  private async getStore(): Promise<Store | null> {
    if (this.store) return this.store;
    try {
      this.store = await load(STORE_FILE);
      return this.store;
    } catch (e) {
      logService.warn(`Failed to load ${STORE_FILE}: ${e}`);
      return null;
    }
  }

  private async loadPersistedDenylist(): Promise<string[]> {
    const store = await this.getStore();
    if (!store) return [];
    try {
      const raw = await store.get<string[]>(STORE_KEY);
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      logService.warn(`Failed to read ${STORE_KEY}: ${e}`);
      return [];
    }
  }

  private async persistDenylist(entries: string[]): Promise<void> {
    const store = await this.getStore();
    if (!store) return;
    try {
      await store.set(STORE_KEY, entries);
      await store.save();
    } catch (e) {
      logService.warn(`Failed to persist ${STORE_KEY}: ${e}`);
    }
  }

  async init(): Promise<void> {
    const persisted = await this.loadPersistedDenylist();

    // Seed the Rust in-memory denylist from disk before reading defaults +
    // stats. This is the canonical source of truth for the user list across
    // launches; the Rust side starts empty each session.
    if (persisted.length > 0) {
      await clipboardPrivacySetUserDenylist(persisted);
    }

    const [defaults, user, stats] = await Promise.all([
      clipboardPrivacyGetDefaultDenylist(),
      clipboardPrivacyGetUserDenylist(),
      clipboardPrivacyGetSessionStats(),
    ]);
    this.defaultDenylist = defaults ?? [];
    this.userDenylist = user ?? [];
    this.sessionStats = stats ?? {};
  }

  async classify(sourceBundleId: string | null): Promise<ClipboardPrivacyClassification | null> {
    const r = await clipboardPrivacyClassify(sourceBundleId);
    if (r?.skip) {
      const stats = await clipboardPrivacyGetSessionStats();
      if (stats) this.sessionStats = stats;
    }
    return r;
  }

  async addToDenylist(bundleId: string): Promise<void> {
    const trimmed = bundleId.trim();
    if (!trimmed) return;
    if (this.userDenylist.some((d) => d.toLowerCase() === trimmed.toLowerCase())) return;
    const next = [...this.userDenylist, trimmed];
    await clipboardPrivacySetUserDenylist(next);
    await this.persistDenylist(next);
    this.userDenylist = next;
  }

  async removeFromDenylist(bundleId: string): Promise<void> {
    const next = this.userDenylist.filter(
      (d) => d.toLowerCase() !== bundleId.toLowerCase(),
    );
    if (next.length === this.userDenylist.length) return;
    await clipboardPrivacySetUserDenylist(next);
    await this.persistDenylist(next);
    this.userDenylist = next;
  }

  async refreshStats(): Promise<void> {
    const stats = await clipboardPrivacyGetSessionStats();
    if (stats) this.sessionStats = stats;
  }

  reset(): void {
    this.defaultDenylist = [];
    this.userDenylist = [];
    this.sessionStats = {};
    this.store = null;
  }
}

export const clipboardPrivacyService = new ClipboardPrivacyService();
