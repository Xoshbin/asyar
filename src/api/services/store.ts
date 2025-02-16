import { load } from "@tauri-apps/plugin-store";
import { log } from "./log";

type StoreOptions = {
  autoSave?: boolean | number;
  path?: string;
};

const DEFAULT_OPTIONS: StoreOptions = {
  autoSave: 100, // Auto save after 100ms
};

export const store = {
  stores: new Map<string, Awaited<ReturnType<typeof load>>>(),

  async getStore(name: string, options: StoreOptions = DEFAULT_OPTIONS) {
    if (this.stores.has(name)) {
      return this.stores.get(name)!;
    }

    try {
      const store = await load(`${name}.json`, options);
      this.stores.set(name, store);
      log.info(`[Store API] Created/loaded store: ${name}`);
      return store;
    } catch (err) {
      log.error(`[Store API] Failed to create/load store ${name}:`);
      throw err;
    }
  },

  async get<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const store = await this.getStore(storeName);
      return (await store.get<T>(key)) ?? null;
    } catch (err) {
      log.error(
        `[Store API] Failed to get key ${key} from store ${storeName}:`
      );
      return null;
    }
  },

  async set<T>(storeName: string, key: string, value: T): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.set(key, value);
      log.info(`[Store API] Set value for ${key} in store ${storeName}`);
      return true;
    } catch (err) {
      log.error(`[Store API] Failed to set key ${key} in store ${storeName}:`);
      return false;
    }
  },

  async save(storeName: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.save();
      log.info(`[Store API] Saved store: ${storeName}`);
      return true;
    } catch (err) {
      log.error(`[Store API] Failed to save store ${storeName}:`);
      return false;
    }
  },

  async clear(storeName: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.clear();
      log.info(`[Store API] Cleared store: ${storeName}`);
      return true;
    } catch (err) {
      log.error(`[Store API] Failed to clear store ${storeName}:`);
      return false;
    }
  },

  async delete(storeName: string, key: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.delete(key);
      log.info(`[Store API] Deleted key ${key} from store ${storeName}`);
      return true;
    } catch (err) {
      log.error(
        `[Store API] Failed to delete key ${key} from store ${storeName}:`
      );
      return false;
    }
  },
} as const;
