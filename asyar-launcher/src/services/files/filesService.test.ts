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
  it('search preserves command failure', async () => {
    invokeMock.mockRejectedValue(new Error('search failed'));
    const promise = filesService.search('ext.a', 'report', {
      typeFilter: 'document',
      limit: 10,
    });
    expect(invokeMock).toHaveBeenCalledWith('file_search', {
      query: 'report',
      typeFilter: 'document',
      limit: 10,
    });
    await expect(promise).rejects.toThrow('search failed');
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
    invokeMock.mockRejectedValue(new Error('status failed'));
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

  it('readRange forwards caller id and opts', async () => {
    const chunk = { text: 'line\n', start: 10, end: 15, size: 15, mtimeMs: 100, eof: true };
    invokeMock.mockResolvedValueOnce(chunk);
    const opts = { offset: 10, maxBytes: 100, align: 'line' as const };
    expect(await filesService.readRange('ext.a', '/tmp/log', opts)).toEqual(chunk);
    expect(invokeMock).toHaveBeenCalledWith('files_read_range', {
      extensionId: 'ext.a',
      pathStr: '/tmp/log',
      opts,
    });
  });

  it('steam_extension_glob_call_contract', async () => {
    const pattern = '/Steam/appcache/librarycache/123/' + '?'.repeat(40) + '.jpg';
    const paths = ['/Steam/appcache/librarycache/123/' + 'a'.repeat(40) + '.jpg'];
    for (const opts of [undefined, { maxResults: 5 }]) {
      invokeMock.mockResolvedValueOnce(paths);
      const hits = await filesService.glob('steam', pattern, opts);
      expect(hits).toEqual(paths);
      expect(typeof hits[0]).toBe('string');
      expect(invokeMock).toHaveBeenLastCalledWith('files_glob', {
        extensionId: 'steam',
        pattern,
        maxResults: opts?.maxResults,
      });
    }
  });

  it('globEntries forwards the caller identity, pattern, and options to files_glob_entries', async () => {
    const paths = [
      { path: 'C:/Steam/appcache/librarycache/105600/dca2.jpg', size: 3, mtimeMs: 10 },
    ];
    invokeMock.mockResolvedValue(paths);
    const result = await filesService.globEntries(
      'ext.a',
      'C:/Steam/appcache/librarycache/**/*.jpg',
      {
        maxResults: 5,
        sort: 'modified-desc',
        modifiedBeforeMs: 20,
      },
    );
    expect(invokeMock).toHaveBeenCalledWith('files_glob_entries', {
      extensionId: 'ext.a',
      pattern: 'C:/Steam/appcache/librarycache/**/*.jpg',
      opts: { maxResults: 5, sort: 'modified-desc', modifiedBeforeMs: 20 },
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
