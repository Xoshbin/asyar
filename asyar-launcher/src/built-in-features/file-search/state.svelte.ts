import {
  fileSearch,
  fileSearchRecent,
  fileSearchPin,
  fileSearchUnpin,
  fileSearchListPinned,
  fileSearchRecordSelection,
  deepSearch,
  deepSearchAvailability,
} from '../../lib/ipc/fileSearchCommands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
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

  reset(): void {
    this.searchQuery = '';
    this.typeFilter = 'all';
    this.results = [];
    this.deepResults = [];
    this.selectedFileId = null;
    this.loading = false;
    this.pinnedFiles = [];
    this.deepSearchProviderId = null;
    this.deepSearchLoading = false;
  }

  setTypeFilter(v: TypeFilter): void {
    this.typeFilter = v;
  }

  /** Every visible row. With no active query, shows pinned files followed
   * by recently modified files (`results` holds the recent list then),
   * both narrowed by the type filter. Once searching, real matches take
   * over — pinned matches already rank first via the backend's pin bonus. */
  get allItems(): FileHit[] {
    if (!this.searchQuery.trim()) {
      const pinnedFiles =
        this.typeFilter === 'all'
          ? this.pinnedFiles
          : this.pinnedFiles.filter((p) => p.type === this.typeFilter);
      const pinned = new Set(pinnedFiles.map((p) => p.fileId));
      return [...pinnedFiles, ...this.results.filter((r) => !pinned.has(r.fileId))];
    }
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
    fileSearchViewState.pinnedFiles = await fileSearchListPinned();
  } catch (err) {
    feedbackService.report({
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
    feedbackService.report({
      source: 'frontend',
      kind: 'file-search/pin-failed',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    });
  }
}

let searchSeq = 0;

/** Searches the index for the current query, or — with an empty query —
 * loads the recently modified files. Like Raycast, the first row is
 * selected so the preview pane is never blank while there's something
 * to show. */
export async function runSearch(): Promise<void> {
  const seq = ++searchSeq;
  const q = fileSearchViewState.searchQuery.trim();
  fileSearchViewState.deepResults = [];
  fileSearchViewState.loading = true;
  try {
    const typeFilter =
      fileSearchViewState.typeFilter === 'all' ? undefined : fileSearchViewState.typeFilter;
    const results = q
      ? ((await fileSearch(q, typeFilter, 50))?.hits ?? [])
      : await fileSearchRecent(typeFilter, 50);
    // A newer keystroke superseded this call; its results win.
    if (seq !== searchSeq) return;
    fileSearchViewState.results = results;
    const items = fileSearchViewState.allItems;
    if (!items.some((r) => r.fileId === fileSearchViewState.selectedFileId)) {
      fileSearchViewState.selectedFileId = items[0]?.fileId ?? null;
    }
  } finally {
    if (seq === searchSeq) fileSearchViewState.loading = false;
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
    const hits = await deepSearch(q, DEEP_SEARCH_LIMIT);
    const existing = new Set(fileSearchViewState.results.map((r) => r.fileId));
    fileSearchViewState.deepResults = hits.filter((h) => !existing.has(h.fileId));
  } catch (err) {
    feedbackService.report({
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
