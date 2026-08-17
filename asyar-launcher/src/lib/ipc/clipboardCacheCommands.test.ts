import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { clipboardAdoptImage, clipboardForgetImage } from './clipboardCacheCommands';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('clipboardAdoptImage', () => {
  it('passes the item id and source path and returns the new location', async () => {
    mockInvoke.mockResolvedValue('/app/data/clipboard_cache/item-1.png');

    const result = await clipboardAdoptImage('item-1', '/plugin/images/998877.png');

    expect(mockInvoke).toHaveBeenCalledWith('clipboard_adopt_image', {
      id: 'item-1',
      sourcePath: '/plugin/images/998877.png',
    });
    expect(result).toBe('/app/data/clipboard_cache/item-1.png');
  });

  // The caller falls back to the plugin's own path, which stays readable —
  // so a failed move must not throw and break clipboard capture.
  it('returns null instead of throwing when the move fails', async () => {
    mockInvoke.mockRejectedValue(new Error('disk full'));
    expect(await clipboardAdoptImage('item-1', '/plugin/images/1.png')).toBeNull();
  });
});

describe('clipboardForgetImage', () => {
  it('passes the path and reports success', async () => {
    mockInvoke.mockResolvedValue(null);
    expect(await clipboardForgetImage('/app/data/clipboard_cache/item-1.png')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('clipboard_forget_image', {
      path: '/app/data/clipboard_cache/item-1.png',
    });
  });

  it('returns false instead of throwing when the delete fails', async () => {
    mockInvoke.mockRejectedValue(new Error('permission denied'));
    expect(await clipboardForgetImage('/app/data/clipboard_cache/item-1.png')).toBe(false);
  });
});
