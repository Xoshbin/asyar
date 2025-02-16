import { load } from "@tauri-apps/plugin-store";
import { log } from "../api/services/log";

type StoreOptions = {
  autoSave?: boolean | number;
  path?: string;
};

export class StoreService {
  private stores = new Map<string, Awaited<ReturnType<typeof load>>>();
  private readonly defaultOptions: StoreOptions = {
    autoSave: 100,
  };

  async getStore(name: string, options: StoreOptions = this.defaultOptions) {
    if (this.stores.has(name)) {
      return this.stores.get(name)!;
    }

    try {
      const store = await load(`${name}.json`, options);
      this.stores.set(name, store);
      log.info(`[Store Service] Created/loaded store: ${name}`);
      return store;
    } catch (err) {
      log.error(`[Store Service] Failed to create/load store ${name}:`);
      throw err;
    }
  }

  async get<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const store = await this.getStore(storeName);
      return (await store.get<T>(key)) ?? null;
    } catch (err) {
      log.error(
        `[Store Service] Failed to get key ${key} from store ${storeName}:`
      );
      return null;
    }
  }

  async set<T>(storeName: string, key: string, value: T): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.set(key, value);
      log.info(`[Store Service] Set value for ${key} in store ${storeName}`);
      return true;
    } catch (err) {
      log.error(
        `[Store Service] Failed to set key ${key} in store ${storeName}:`
      );
      return false;
    }
  }

  async save(storeName: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.save();
      log.info(`[Store Service] Saved store: ${storeName}`);
      return true;
    } catch (err) {
      log.error(`[Store Service] Failed to save store ${storeName}:`);
      return false;
    }
  }

  async clear(storeName: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.clear();
      log.info(`[Store Service] Cleared store: ${storeName}`);
      return true;
    } catch (err) {
      log.error(`[Store Service] Failed to clear store ${storeName}:`);
      return false;
    }
  }

  async delete(storeName: string, key: string): Promise<boolean> {
    try {
      const store = await this.getStore(storeName);
      await store.delete(key);
      log.info(`[Store Service] Deleted key ${key} from store ${storeName}`);
      return true;
    } catch (err) {
      log.error(
        `[Store Service] Failed to delete key ${key} from store ${storeName}:`
      );
      return false;
    }
  }
}
