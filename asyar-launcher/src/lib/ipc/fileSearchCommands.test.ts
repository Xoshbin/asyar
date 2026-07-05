import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn(), registerRetry: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import {
  fileSearch,
  fileIndexStatus,
  fileIndexRebuild,
  fileIndexSetConfig,
  fileSearchRecordSelection,
  fileSearchPin,
  fileSearchUnpin,
  fileSearchListPinned,
  fileSearchClearHistory,
  deepSearchAvailability,
  deepSearch,
  openInTerminal,
  quickLookPath,
  readTextPreview,
} from './fileSearchCommands';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fileSearch', () => {
  it('calls invoke with query, typeFilter, and limit', async () => {
    mockInvoke.mockResolvedValue({ hits: [], truncated: false, scannedAll: true, indexGeneration: 0, work: {} });
    await fileSearch('report', 'document', 20);
    expect(mockInvoke).toHaveBeenCalledWith('file_search', {
      query: 'report',
      typeFilter: 'document',
      limit: 20,
    });
  });

  it('defaults typeFilter and limit to null/undefined when omitted', async () => {
    mockInvoke.mockResolvedValue(null);
    await fileSearch('x');
    expect(mockInvoke).toHaveBeenCalledWith('file_search', {
      query: 'x',
      typeFilter: null,
      limit: undefined,
    });
  });

  it('returns the FileSearchResponse payload', async () => {
    const expected = { hits: [{ fileId: 'abc', name: 'a.txt' }], truncated: false, scannedAll: true, indexGeneration: 1, work: {} };
    mockInvoke.mockResolvedValue(expected);
    const result = await fileSearch('a');
    expect(result).toEqual(expected);
  });
});

describe('fileIndexStatus', () => {
  it('calls invoke with file_index_status', async () => {
    mockInvoke.mockResolvedValue({ state: 'ready', entryCount: 10, lastScanMs: 5, snapshotLoaded: true, capReached: false });
    await fileIndexStatus();
    expect(mockInvoke).toHaveBeenCalledWith('file_index_status', undefined);
  });
});

describe('fileIndexRebuild', () => {
  it('calls invoke with file_index_rebuild and returns a boolean signal', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await fileIndexRebuild();
    expect(mockInvoke).toHaveBeenCalledWith('file_index_rebuild', undefined);
    expect(result).toBe(true);
  });
});

describe('fileIndexSetConfig', () => {
  it('calls invoke with file_index_set_config and the config payload', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const cfg = { enabled: true, includeRoots: [], excludePatterns: ['skip'], indexHidden: false };
    await fileIndexSetConfig(cfg);
    expect(mockInvoke).toHaveBeenCalledWith('file_index_set_config', { config: cfg });
  });
});

describe('fileSearchRecordSelection', () => {
  it('calls invoke with query and fileId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await fileSearchRecordSelection('report', 'abc123');
    expect(mockInvoke).toHaveBeenCalledWith('file_search_record_selection', {
      query: 'report',
      fileId: 'abc123',
    });
  });
});

describe('fileSearchPin / fileSearchUnpin / fileSearchListPinned', () => {
  it('pin calls invoke with fileId and path', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await fileSearchPin('abc123', '/tmp/a.txt');
    expect(mockInvoke).toHaveBeenCalledWith('file_search_pin', { fileId: 'abc123', path: '/tmp/a.txt' });
  });

  it('unpin calls invoke with fileId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await fileSearchUnpin('abc123');
    expect(mockInvoke).toHaveBeenCalledWith('file_search_unpin', { fileId: 'abc123' });
  });

  it('listPinned calls invoke and returns the hit array', async () => {
    const expected = [{ fileId: 'abc123', name: 'a.txt' }];
    mockInvoke.mockResolvedValue(expected);
    const result = await fileSearchListPinned();
    expect(mockInvoke).toHaveBeenCalledWith('file_search_list_pinned', undefined);
    expect(result).toEqual(expected);
  });
});

describe('fileSearchClearHistory', () => {
  it('calls invoke with file_search_clear_history', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await fileSearchClearHistory();
    expect(mockInvoke).toHaveBeenCalledWith('file_search_clear_history', undefined);
  });
});

describe('deepSearchAvailability', () => {
  it('calls invoke and returns the provider id or null', async () => {
    mockInvoke.mockResolvedValue('mdfind');
    const result = await deepSearchAvailability();
    expect(mockInvoke).toHaveBeenCalledWith('deep_search_availability', undefined);
    expect(result).toBe('mdfind');
  });
});

describe('deepSearch', () => {
  it('calls invoke with query and limit', async () => {
    mockInvoke.mockResolvedValue([]);
    await deepSearch('report', 10);
    expect(mockInvoke).toHaveBeenCalledWith('deep_search', { query: 'report', limit: 10 });
  });
});

describe('openInTerminal', () => {
  it('calls invoke with pathStr and returns a boolean signal', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await openInTerminal('/tmp/dir');
    expect(mockInvoke).toHaveBeenCalledWith('open_in_terminal', { pathStr: '/tmp/dir' });
    expect(result).toBe(true);
  });
});

describe('quickLookPath', () => {
  it('calls invoke with pathStr and returns a boolean signal', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await quickLookPath('/tmp/a.pdf');
    expect(mockInvoke).toHaveBeenCalledWith('quick_look_path', { pathStr: '/tmp/a.pdf' });
    expect(result).toBe(true);
  });
});

describe('readTextPreview', () => {
  it('calls invoke with pathStr and maxBytes', async () => {
    mockInvoke.mockResolvedValue('hello world');
    const result = await readTextPreview('/tmp/a.txt', 50_000);
    expect(mockInvoke).toHaveBeenCalledWith('read_text_preview', {
      pathStr: '/tmp/a.txt',
      maxBytes: 50_000,
    });
    expect(result).toBe('hello world');
  });

  it('omits maxBytes when not provided', async () => {
    mockInvoke.mockResolvedValue('x');
    await readTextPreview('/tmp/a.txt');
    expect(mockInvoke).toHaveBeenCalledWith('read_text_preview', {
      pathStr: '/tmp/a.txt',
      maxBytes: undefined,
    });
  });

  it('returns null (not throw) on invoke failure', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    const result = await readTextPreview('/tmp/a.txt');
    expect(result).toBeNull();
  });
});
