import {
  fileSearch,
  fileSearchPin,
  fileSearchUnpin,
  fileSearchListPinned,
  fileSearchRecordSelection,
  deepSearch,
  deepSearchAvailability,
} from '../../lib/ipc/fileSearchCommands';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import type { FileHit, FileType } from 'asyar-sdk/contracts';

export type TypeFilter = 'all' | FileType;

const DEEP_SEARCH_LIMIT = 50;

class FileSearchViewState {
  searchQuery = $state('');
  typeFilter = $state<TypeFilter>('all');
  results = $state<FileHit[]>([]);
  deepResults = $state<FileHit[]>([]);
  selectedFileId = $state<string | null>(null);
  loading = $state(false);
  pinnedFiles = $state<FileHit[]>([]);
  deepSearchProviderId = $state<string | null>(null);
  deepSearchLoading = $state(false);

  setTypeFilter(v: TypeFilter): void {
    this.typeFilter = v;
  }

  /** Every visible row, real matches first, deep-search results appended. */
  get allItems(): FileHit[] {
    return [...this.results, ...this.deepResults];
  }

  moveSelection(dir: 'up' | 'down'): void {
    const list = this.allItems;
    if (list.length === 0) return;
    const currentIdx = this.selectedFileId
      ? list.findIndex((r) => r.fileId === this.selectedFileId)
      : -1;
    let next: number;
    if (dir === 'down') {
      next = currentIdx < 0 ? 0 : Math.min(list.length - 1, currentIdx + 1);
    } else {
      next = currentIdx < 0 ? list.length - 1 : Math.max(0, currentIdx - 1);
    }
    this.selectedFileId = list[next].fileId;
  }
}

export const fileSearchViewState = new FileSearchViewState();

export function getSelectedFile(): FileHit | undefined {
  const id = fileSearchViewState.selectedFileId;
  if (!id) return undefined;
  return (
    fileSearchViewState.allItems.find((r) => r.fileId === id) ??
    fileSearchViewState.pinnedFiles.find((p) => p.fileId === id)
  );
}

export async function loadPinnedFiles(): Promise<void> {
  try {
    fileSearchViewState.pinnedFiles = (await fileSearchListPinned()) ?? [];
  } catch (err) {
    diagnosticsService.report({
      source: 'frontend',
      kind: 'file-search/load-pinned-failed',
      severity: 'warning',
      retryable: true,
      developerDetail: String(err),
    });
  }
}

export async function togglePin(fileId: string, path: string): Promise<void> {
  const isPinned = fileSearchViewState.pinnedFiles.some((p) => p.fileId === fileId);
  try {
    if (isPinned) {
      await fileSearchUnpin(fileId);
    } else {
      await fileSearchPin(fileId, path);
    }
    await loadPinnedFiles();
  } catch (err) {
    diagnosticsService.report({
      source: 'frontend',
      kind: 'file-search/pin-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
  }
}

export async function runSearch(): Promise<void> {
  const q = fileSearchViewState.searchQuery.trim();
  fileSearchViewState.deepResults = [];
  if (!q) {
    fileSearchViewState.results = [];
    return;
  }
  fileSearchViewState.loading = true;
  try {
    const typeFilter =
      fileSearchViewState.typeFilter === 'all' ? undefined : fileSearchViewState.typeFilter;
    const response = await fileSearch(q, typeFilter, 50);
    const results = response?.hits ?? [];
    fileSearchViewState.results = results;
    if (
      fileSearchViewState.selectedFileId &&
      !results.some((r) => r.fileId === fileSearchViewState.selectedFileId)
    ) {
      fileSearchViewState.selectedFileId = results[0]?.fileId ?? null;
    }
  } finally {
    fileSearchViewState.loading = false;
  }
}

export async function recordSelectionForCurrentQuery(fileId: string): Promise<void> {
  const q = fileSearchViewState.searchQuery.trim();
  if (!q) return;
  await fileSearchRecordSelection(q, fileId);
}

/** Probes deep-search availability once per view activation. */
export async function checkDeepSearchAvailability(): Promise<void> {
  fileSearchViewState.deepSearchProviderId = await deepSearchAvailability();
}

/** Runs the current query through the on-demand OS-native provider and
 * appends results below the local index's matches. Deliberately never
 * runs per keystroke — only on explicit user action. */
export async function runDeepSearch(): Promise<void> {
  const q = fileSearchViewState.searchQuery.trim();
  if (!q || !fileSearchViewState.deepSearchProviderId) return;
  fileSearchViewState.deepSearchLoading = true;
  try {
    const hits = (await deepSearch(q, DEEP_SEARCH_LIMIT)) ?? [];
    const existing = new Set(fileSearchViewState.results.map((r) => r.fileId));
    fileSearchViewState.deepResults = hits.filter((h) => !existing.has(h.fileId));
  } catch (err) {
    diagnosticsService.report({
      source: 'frontend',
      kind: 'file-search/deep-search-failed',
      severity: 'warning',
      retryable: true,
      developerDetail: String(err),
    });
  } finally {
    fileSearchViewState.deepSearchLoading = false;
  }
}
