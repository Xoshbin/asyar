import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn(), registerRetry: vi.fn() },
}));

import { filesService } from './filesService';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('filesService', () => {
  it('search calls file_search with query and opts, returns [] on null', async () => {
    invokeMock.mockResolvedValue(null);
    const result = await filesService.search('ext.a', 'report', {
      typeFilter: 'document',
      limit: 10,
    });
    expect(invokeMock).toHaveBeenCalledWith('file_search', {
      query: 'report',
      typeFilter: 'document',
      limit: 10,
    });
    expect(result).toEqual([]);
  });

  it('search returns the hits array when present', async () => {
    const hits = [{ fileId: 'abc', name: 'a.pdf' }];
    invokeMock.mockResolvedValue({
      hits,
      truncated: false,
      scannedAll: true,
      indexGeneration: 1,
      work: {},
    });
    const result = await filesService.search(null, 'a');
    expect(result).toEqual(hits);
  });

  it('status returns a safe default when the command fails', async () => {
    invokeMock.mockResolvedValue(null);
    const result = await filesService.status(null);
    expect(invokeMock).toHaveBeenCalledWith('file_index_status', undefined);
    expect(result.state).toBe('disabled');
    expect(result.entryCount).toBe(0);
  });

  it('status returns the real payload when present', async () => {
    const status = {
      state: 'ready',
      entryCount: 42,
      lastScanMs: 5,
      snapshotLoaded: true,
      capReached: false,
    };
    invokeMock.mockResolvedValue(status);
    const result = await filesService.status(null);
    expect(result).toEqual(status);
  });

  it('read forwards the caller identity and path to files_read_text', async () => {
    invokeMock.mockResolvedValue('"libraryfolders" {}');
    const result = await filesService.read('ext.a', 'D:/SteamLibrary/steamapps/lib.vdf', {
      maxBytes: 1000,
    });
    expect(invokeMock).toHaveBeenCalledWith('files_read_text', {
      extensionId: 'ext.a',
      pathStr: 'D:/SteamLibrary/steamapps/lib.vdf',
      maxBytes: 1000,
    });
    expect(result).toBe('"libraryfolders" {}');
  });

  it('read propagates denials as errors instead of swallowing them', async () => {
    invokeMock.mockRejectedValue(new Error('files:read path is not covered'));
    await expect(filesService.read('ext.a', '/etc/shadow')).rejects.toThrow('not covered');
  });

  it('glob forwards the caller identity, pattern, and cap to files_glob', async () => {
    const paths = ['C:/Steam/appcache/librarycache/105600/dca2.jpg'];
    invokeMock.mockResolvedValue(paths);
    const result = await filesService.glob('ext.a', 'C:/Steam/appcache/librarycache/**/*.jpg', {
      maxResults: 5,
    });
    expect(invokeMock).toHaveBeenCalledWith('files_glob', {
      extensionId: 'ext.a',
      pattern: 'C:/Steam/appcache/librarycache/**/*.jpg',
      maxResults: 5,
    });
    expect(result).toEqual(paths);
  });

  it('glob propagates scope denials as errors', async () => {
    invokeMock.mockRejectedValue(new Error('outside the declared files:read scope'));
    await expect(filesService.glob('ext.a', 'C:/**')).rejects.toThrow('outside the declared');
  });

  it('thumbnail forwards the caller identity and path to files_thumbnail', async () => {
    invokeMock.mockResolvedValue('http://asyar-thumb.localhost/abc.png');
    const result = await filesService.thumbnail('ext.a', 'C:/Steam/art.jpg', { maxDim: 64 });
    expect(invokeMock).toHaveBeenCalledWith('files_thumbnail', {
      extensionId: 'ext.a',
      pathStr: 'C:/Steam/art.jpg',
      maxDim: 64,
    });
    expect(result).toBe('http://asyar-thumb.localhost/abc.png');
  });

  it('thumbnail passes through the no-strategy null', async () => {
    invokeMock.mockResolvedValue(null);
    const result = await filesService.thumbnail('ext.a', 'C:/Steam/notes.txt');
    expect(result).toBeNull();
  });
});
