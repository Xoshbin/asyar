import { describe, expect, it, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn(), registerRetry: vi.fn() },
}));

import { filesService } from './filesService';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('filesService', () => {
  it('search calls file_search with query and opts, returns [] on null', async () => {
    invokeMock.mockResolvedValue(null);
    const result = await filesService.search('report', { typeFilter: 'document', limit: 10 });
    expect(invokeMock).toHaveBeenCalledWith('file_search', {
      query: 'report',
      typeFilter: 'document',
      limit: 10,
    });
    expect(result).toEqual([]);
  });

  it('search returns the hits array when present', async () => {
    const hits = [{ fileId: 'abc', name: 'a.pdf' }];
    invokeMock.mockResolvedValue({ hits, truncated: false, scannedAll: true, indexGeneration: 1, work: {} });
    const result = await filesService.search('a');
    expect(result).toEqual(hits);
  });

  it('status returns a safe default when the command fails', async () => {
    invokeMock.mockResolvedValue(null);
    const result = await filesService.status();
    expect(invokeMock).toHaveBeenCalledWith('file_index_status', undefined);
    expect(result.state).toBe('disabled');
    expect(result.entryCount).toBe(0);
  });

  it('status returns the real payload when present', async () => {
    const status = { state: 'ready', entryCount: 42, lastScanMs: 5, snapshotLoaded: true, capReached: false };
    invokeMock.mockResolvedValue(status);
    const result = await filesService.status();
    expect(result).toEqual(status);
  });
});
