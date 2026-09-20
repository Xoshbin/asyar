import { getActiveContext } from './context';
import type { IStorageService } from 'asyar-sdk/contracts';

export namespace LocalStorage {
  export type Value = string | number | boolean;

  function getService(): IStorageService {
    return getActiveContext().getService<IStorageService>('storage');
  }

  function parseStoredValue<T>(raw: string | null): T | undefined {
    if (raw === null || raw === undefined) {
      return undefined;
    }
    // Try to parse JSON for boolean, number, array, object
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  export async function getItem<T = Value>(key: string): Promise<T | undefined> {
    const service = getService();
    const raw = await service.get(key);
    return parseStoredValue<T>(raw);
  }

  export async function setItem(key: string, value: Value | object): Promise<void> {
    const service = getService();
    await service.set(key, JSON.stringify(value));
  }

  export async function removeItem(key: string): Promise<void> {
    const service = getService();
    await service.delete(key);
  }

  export async function clear(): Promise<void> {
    const service = getService();
    await service.clear();
  }

  export async function allItems<T = { [key: string]: Value }>(): Promise<T> {
    const service = getService();
    const rawRecord = await service.getAll();
    const result: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(rawRecord)) {
      result[k] = parseStoredValue(v);
    }

    return result as T;
  }
}
