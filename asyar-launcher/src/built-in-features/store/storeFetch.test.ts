import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllStoreItems } from './storeFetch';

describe('fetchAllStoreItems', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches store items with per_page=100', async () => {
    const mockItems = [{ id: 1, name: 'Extension 1' }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockItems, next_page_url: null }),
    } as Response);

    const result = await fetchAllStoreItems();

    expect(globalThis.fetch).toHaveBeenCalledWith('https://asyar.org/api/extensions?per_page=100');
    expect(result).toEqual(mockItems);
  });

  it('follows next_page_url when pagination exists', async () => {
    const page1Items = [{ id: 1, name: 'Ext 1' }];
    const page2Items = [{ id: 2, name: 'Ext 2' }];

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: page1Items,
          next_page_url: 'https://asyar.org/api/extensions?page=2&per_page=100',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: page2Items,
          next_page_url: null,
        }),
      } as Response);

    const result = await fetchAllStoreItems();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([...page1Items, ...page2Items]);
  });

  it('handles direct array responses from API', async () => {
    const arrayItems = [{ id: 1, name: 'Ext 1' }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => arrayItems,
    } as Response);

    const result = await fetchAllStoreItems();
    expect(result).toEqual(arrayItems);
  });

  it('throws when HTTP response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(fetchAllStoreItems()).rejects.toThrow('HTTP error! status: 500');
  });
});
