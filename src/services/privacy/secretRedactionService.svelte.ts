import { load, type Store } from '@tauri-apps/plugin-store';
import {
  secretDetectionGetCatalog,
  secretDetectionGetSessionStats,
  secretDetectionRedact,
  type SecretDetectorRule,
  type SecretRedactionResult,
} from '../../lib/ipc/commands';
import { logService } from '../log/logService';

const STORE_FILE = 'secret-redaction.dat';
const STORE_KEY = 'settings';

export type RedactionCategory = 'clipboard' | 'snippets' | 'aiConversations';

export interface PersistedRedactionSettings {
  master: boolean;
  clipboard: boolean;
  snippets: boolean;
  aiConversations: boolean;
}

const DEFAULT_SETTINGS: PersistedRedactionSettings = {
  master: true,
  clipboard: true,
  snippets: true,
  aiConversations: true,
};

/**
 * Reactive wrapper around the Rust pattern-redaction filter.
 * Detection runs in [`crate::secret_detection::redact`]; this service
 * gates that call by user toggles, persists the toggles, and tracks the
 * session stats for the privacy UI.
 */
export class SecretRedactionService {
  catalog = $state<SecretDetectorRule[]>([]);
  sessionStats = $state<Record<string, number>>({});
  settings = $state<PersistedRedactionSettings>({ ...DEFAULT_SETTINGS });

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

  private async loadPersistedSettings(): Promise<PersistedRedactionSettings> {
    const store = await this.getStore();
    if (!store) return { ...DEFAULT_SETTINGS };
    try {
      const raw = await store.get<PersistedRedactionSettings>(STORE_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...raw } : { ...DEFAULT_SETTINGS };
    } catch (e) {
      logService.warn(`Failed to read ${STORE_KEY}: ${e}`);
      return { ...DEFAULT_SETTINGS };
    }
  }

  private async persistSettings(): Promise<void> {
    const store = await this.getStore();
    if (!store) return;
    try {
      await store.set(STORE_KEY, this.settings);
      await store.save();
    } catch (e) {
      logService.warn(`Failed to persist ${STORE_KEY}: ${e}`);
    }
  }

  async init(): Promise<void> {
    const [catalog, stats, persisted] = await Promise.all([
      secretDetectionGetCatalog(),
      secretDetectionGetSessionStats(),
      this.loadPersistedSettings(),
    ]);
    this.catalog = catalog ?? [];
    this.sessionStats = stats ?? {};
    this.settings = persisted;
  }

  async redactIfEnabled(
    category: RedactionCategory,
    text: string,
  ): Promise<SecretRedactionResult | null> {
    if (!this.settings.master) return null;
    if (!this.settings[category]) return null;
    const r = await secretDetectionRedact(text);
    if (r && r.kinds.length > 0) {
      const stats = await secretDetectionGetSessionStats();
      if (stats) this.sessionStats = stats;
    }
    return r;
  }

  async setMasterEnabled(enabled: boolean): Promise<void> {
    this.settings = { ...this.settings, master: enabled };
    await this.persistSettings();
  }

  async setCategoryEnabled(category: RedactionCategory, enabled: boolean): Promise<void> {
    this.settings = { ...this.settings, [category]: enabled };
    await this.persistSettings();
  }

  async refreshStats(): Promise<void> {
    const stats = await secretDetectionGetSessionStats();
    if (stats) this.sessionStats = stats;
  }

  reset(): void {
    this.catalog = [];
    this.sessionStats = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.store = null;
  }
}

export const secretRedactionService = new SecretRedactionService();
