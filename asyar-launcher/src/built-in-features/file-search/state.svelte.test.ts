import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));
vi.mock('../../lib/ipc/fileSearchCommands', () => ({
  fileSearch: vi.fn(),
  fileSearchPin: vi.fn(),
  fileSearchUnpin: vi.fn(),
  fileSearchListPinned: vi.fn(),
  fileSearchRecordSelection: vi.fn(),
  deepSearch: vi.fn(),
  deepSearchAvailability: vi.fn(),
}));

import {
  fileSearch,
  fileSearchPin,
  fileSearchUnpin,
  fileSearchListPinned,
  fileSearchRecordSelection,
  deepSearch,
  deepSearchAvailability,
} from '../../lib/ipc/fileSearchCommands';
import {
  fileSearchViewState,
  getSelectedFile,
  loadPinnedFiles,
  togglePin,
  runSearch,
  recordSelectionForCurrentQuery,
  checkDeepSearchAvailability,
  runDeepSearch,
} from './state.svelte';

function hit(fileId: string, name = fileId): any {
  return { fileId, name, path: `/r/${name}`, type: 'document', isDir: false, modifiedAt: 0, score: 1, pinned: false, source: 'local' };
}

beforeEach(() => {
  vi.clearAllMocks();
  fileSearchViewState.searchQuery = '';
  fileSearchViewState.typeFilter = 'all';
  fileSearchViewState.results = [];
  fileSearchViewState.deepResults = [];
  fileSearchViewState.selectedFileId = null;
  fileSearchViewState.pinnedFiles = [];
  fileSearchViewState.deepSearchProviderId = null;
});

describe('runSearch', () => {
  it('clears results for an empty query without calling the backend', async () => {
    fileSearchViewState.searchQuery = '   ';
    await runSearch();
    expect(fileSearch).not.toHaveBeenCalled();
    expect(fileSearchViewState.results).toEqual([]);
  });

  it('passes the trimmed query, resolved typeFilter, and a 50 limit', async () => {
    vi.mocked(fileSearch).mockResolvedValue({ hits: [hit('a')], truncated: false, scannedAll: true, indexGeneration: 1, work: {} as any });
    fileSearchViewState.searchQuery = ' report ';
    fileSearchViewState.typeFilter = 'document';
    await runSearch();
    expect(fileSearch).toHaveBeenCalledWith('report', 'document', 50);
    expect(fileSearchViewState.results).toEqual([hit('a')]);
  });

  it('passes undefined typeFilter for "all"', async () => {
    vi.mocked(fileSearch).mockResolvedValue({ hits: [], truncated: false, scannedAll: true, indexGeneration: 1, work: {} as any });
    fileSearchViewState.searchQuery = 'x';
    fileSearchViewState.typeFilter = 'all';
    await runSearch();
    expect(fileSearch).toHaveBeenCalledWith('x', undefined, 50);
  });

  it('resets selection when the previously selected file drops out of results', async () => {
    vi.mocked(fileSearch).mockResolvedValue({ hits: [hit('b')], truncated: false, scannedAll: true, indexGeneration: 1, work: {} as any });
    fileSearchViewState.searchQuery = 'x';
    fileSearchViewState.selectedFileId = 'gone';
    await runSearch();
    expect(fileSearchViewState.selectedFileId).toBe('b');
  });

  it('clears deepResults on every new search', async () => {
    vi.mocked(fileSearch).mockResolvedValue({ hits: [], truncated: false, scannedAll: true, indexGeneration: 1, work: {} as any });
    fileSearchViewState.deepResults = [hit('stale-deep')];
    fileSearchViewState.searchQuery = 'x';
    await runSearch();
    expect(fileSearchViewState.deepResults).toEqual([]);
  });
});

describe('allItems', () => {
  it('shows pinned files when there is no active query', () => {
    fileSearchViewState.searchQuery = '';
    fileSearchViewState.results = [];
    fileSearchViewState.deepResults = [];
    fileSearchViewState.pinnedFiles = [hit('pinned-a'), hit('pinned-b')];
    expect(fileSearchViewState.allItems.map((i) => i.fileId)).toEqual(['pinned-a', 'pinned-b']);
  });

  it('shows real + deep results (not pinned) once there is an active query', () => {
    fileSearchViewState.searchQuery = 'report';
    fileSearchViewState.results = [hit('a')];
    fileSearchViewState.deepResults = [hit('b')];
    fileSearchViewState.pinnedFiles = [hit('pinned-only')];
    expect(fileSearchViewState.allItems.map((i) => i.fileId)).toEqual(['a', 'b']);
  });

  it('is empty when there is no query and nothing is pinned', () => {
    fileSearchViewState.searchQuery = '';
    fileSearchViewState.pinnedFiles = [];
    expect(fileSearchViewState.allItems).toEqual([]);
  });
});

describe('getSelectedFile / moveSelection', () => {
  it('finds the selected file among combined local + deep results', () => {
    fileSearchViewState.searchQuery = 'x';
    fileSearchViewState.results = [hit('a')];
    fileSearchViewState.deepResults = [hit('b')];
    fileSearchViewState.selectedFileId = 'b';
    expect(getSelectedFile()?.fileId).toBe('b');
  });

  it('falls back to pinned files when not in current results', () => {
    fileSearchViewState.pinnedFiles = [hit('pinned-only')];
    fileSearchViewState.selectedFileId = 'pinned-only';
    expect(getSelectedFile()?.fileId).toBe('pinned-only');
  });

  it('moveSelection wraps and steps through the combined list', () => {
    fileSearchViewState.searchQuery = 'x';
    fileSearchViewState.results = [hit('a'), hit('b')];
    fileSearchViewState.deepResults = [hit('c')];
    fileSearchViewState.selectedFileId = null;
    fileSearchViewState.moveSelection('down');
    expect(fileSearchViewState.selectedFileId).toBe('a');
    fileSearchViewState.moveSelection('down');
    expect(fileSearchViewState.selectedFileId).toBe('b');
    fileSearchViewState.moveSelection('up');
    expect(fileSearchViewState.selectedFileId).toBe('a');
  });
});

describe('togglePin', () => {
  it('pins when not already pinned, then reloads the pinned list', async () => {
    vi.mocked(fileSearchListPinned).mockResolvedValue([hit('a')]);
    await togglePin('a', '/r/a');
    expect(fileSearchPin).toHaveBeenCalledWith('a', '/r/a');
    expect(fileSearchUnpin).not.toHaveBeenCalled();
    expect(fileSearchViewState.pinnedFiles).toEqual([hit('a')]);
  });

  it('unpins when already pinned', async () => {
    fileSearchViewState.pinnedFiles = [hit('a')];
    vi.mocked(fileSearchListPinned).mockResolvedValue([]);
    await togglePin('a', '/r/a');
    expect(fileSearchUnpin).toHaveBeenCalledWith('a');
    expect(fileSearchPin).not.toHaveBeenCalled();
  });
});

describe('loadPinnedFiles', () => {
  it('defaults to an empty array when the backend returns null', async () => {
    vi.mocked(fileSearchListPinned).mockResolvedValue(null as any);
    await loadPinnedFiles();
    expect(fileSearchViewState.pinnedFiles).toEqual([]);
  });
});

describe('recordSelectionForCurrentQuery', () => {
  it('no-ops for an empty query', async () => {
    fileSearchViewState.searchQuery = '  ';
    await recordSelectionForCurrentQuery('a');
    expect(fileSearchRecordSelection).not.toHaveBeenCalled();
  });

  it('records the trimmed query with the file id', async () => {
    fileSearchViewState.searchQuery = ' report ';
    await recordSelectionForCurrentQuery('a');
    expect(fileSearchRecordSelection).toHaveBeenCalledWith('report', 'a');
  });
});

describe('deep search', () => {
  it('checkDeepSearchAvailability stores the provider id', async () => {
    vi.mocked(deepSearchAvailability).mockResolvedValue('mdfind');
    await checkDeepSearchAvailability();
    expect(fileSearchViewState.deepSearchProviderId).toBe('mdfind');
  });

  it('runDeepSearch no-ops without a provider', async () => {
    fileSearchViewState.searchQuery = 'x';
    fileSearchViewState.deepSearchProviderId = null;
    await runDeepSearch();
    expect(deepSearch).not.toHaveBeenCalled();
  });

  it('runDeepSearch dedupes against existing local results', async () => {
    fileSearchViewState.searchQuery = 'x';
    fileSearchViewState.deepSearchProviderId = 'mdfind';
    fileSearchViewState.results = [hit('a')];
    vi.mocked(deepSearch).mockResolvedValue([hit('a'), hit('newone')]);
    await runDeepSearch();
    expect(fileSearchViewState.deepResults).toEqual([hit('newone')]);
  });
});
