import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalStorage } from './storage';
import { setRaycastContext } from './context';
import type { IStorageService } from 'asyar-sdk/contracts';

describe('LocalStorage compat API', () => {
  let mockStorageService: Partial<IStorageService>;
  let memoryStore: Record<string, string>;

  beforeEach(() => {
    memoryStore = {};
    mockStorageService = {
      get: vi.fn().mockImplementation(async (key: string) => memoryStore[key] ?? null),
      set: vi.fn().mockImplementation(async (key: string, value: string) => {
        memoryStore[key] = value;
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        const existed = key in memoryStore;
        delete memoryStore[key];
        return existed;
      }),
      clear: vi.fn().mockImplementation(async () => {
        const count = Object.keys(memoryStore).length;
        memoryStore = {};
        return count;
      }),
      getAll: vi.fn().mockImplementation(async () => ({ ...memoryStore })),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'storage') return mockStorageService;
        throw new Error(`Unknown service ${ns}`);
      }),
    } as any);
  });

  it('stores and retrieves string values', async () => {
    await LocalStorage.setItem('greeting', 'hello');
    expect(mockStorageService.set).toHaveBeenCalledWith('greeting', JSON.stringify('hello'));

    const result = await LocalStorage.getItem<string>('greeting');
    expect(result).toBe('hello');
  });

  it('stores and retrieves boolean and number values as parsed types', async () => {
    await LocalStorage.setItem('count', 42);
    await LocalStorage.setItem('enabled', true);

    const count = await LocalStorage.getItem<number>('count');
    const enabled = await LocalStorage.getItem<boolean>('enabled');

    expect(count).toBe(42);
    expect(enabled).toBe(true);
  });

  it('stores and retrieves JSON objects and arrays', async () => {
    const user = { name: 'Alice', age: 30 };
    await LocalStorage.setItem('user', user as any);

    const retrieved = await LocalStorage.getItem<typeof user>('user');
    expect(retrieved).toEqual(user);
  });

  it('returns undefined for non-existent keys', async () => {
    const result = await LocalStorage.getItem('nonexistent');
    expect(result).toBeUndefined();
  });

  it('removes an item', async () => {
    await LocalStorage.setItem('temp', 'val');
    await LocalStorage.removeItem('temp');

    expect(mockStorageService.delete).toHaveBeenCalledWith('temp');
    expect(await LocalStorage.getItem('temp')).toBeUndefined();
  });

  it('clears all items', async () => {
    await LocalStorage.setItem('k1', 'v1');
    await LocalStorage.setItem('k2', 'v2');
    await LocalStorage.clear();

    expect(mockStorageService.clear).toHaveBeenCalled();
    expect(await LocalStorage.getItem('k1')).toBeUndefined();
  });

  it('returns all items with parsed values', async () => {
    await LocalStorage.setItem('name', 'Bob');
    await LocalStorage.setItem('score', 99);
    await LocalStorage.setItem('active', false);

    const all = await LocalStorage.allItems();
    expect(all).toEqual({
      name: 'Bob',
      score: 99,
      active: false,
    });
  });
});
