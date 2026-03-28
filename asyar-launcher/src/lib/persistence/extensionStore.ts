import { envService } from '../../services/envService';
import type { Store } from '@tauri-apps/plugin-store';

/**
 * Cache of loaded Tauri Store instances keyed by file path.
 * Avoids re-loading the same file on every load/save call.
 */
const storeCache = new Map<string, Store>();

async function getTauriStore(filePath: string): Promise<Store> {
  if (storeCache.has(filePath)) return storeCache.get(filePath)!;
  const { load } = await import('@tauri-apps/plugin-store');
  const store = await load(filePath);
  storeCache.set(filePath, store);
  return store as Store;
}

/**
 * Creates a persistence adapter for a given storage key.
 * Uses Tauri plugin-store when available, falls back to localStorage.
 * 
 * @param storageKey The localStorage key (e.g. 'asyar:snippets')
 * @param storeFile  The Tauri store filename (e.g. 'snippets.dat')
 */
export function createPersistence<T>(storageKey: string, storeFile: string) {
  return {
    async load(fallback: T): Promise<T> {
      if (envService.isTauri) {
        try {
          const store = await getTauriStore(storeFile);
          const data = await store.get<T>(storageKey);
          if (data !== null && data !== undefined) return data;
          // Migrate from localStorage if Tauri store is empty
          return migrateFromLocalStorage(storageKey, storeFile, fallback);
        } catch {
          return loadFromLocalStorage(storageKey, fallback);
        }
      }
      return loadFromLocalStorage(storageKey, fallback);
    },

    async save(data: T): Promise<void> {
      if (envService.isTauri) {
        try {
          const store = await getTauriStore(storeFile);
          await store.set(storageKey, data);
          await store.save();
          return;
        } catch {
          // Fall through to localStorage
        }
      }
      saveToLocalStorage(storageKey, data);
    },

    /** Synchronous load for store initialization (localStorage only, before async init) */
    loadSync(fallback: T): T {
      return loadFromLocalStorage(storageKey, fallback);
    },
  };
}

function loadFromLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Merge objects (for settings-like data), return arrays/primitives directly
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

function saveToLocalStorage(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage may be unavailable
  }
}

async function migrateFromLocalStorage<T>(storageKey: string, storeFile: string, fallback: T): Promise<T> {
  const data = loadFromLocalStorage(storageKey, fallback);
  // If there was data in localStorage, migrate it to Tauri store
  if (data !== fallback) {
    try {
      const store = await getTauriStore(storeFile);
      await store.set(storageKey, data);
      await store.save();
    } catch {
      // Migration failed, still return the data
    }
  }
  return data;
}
