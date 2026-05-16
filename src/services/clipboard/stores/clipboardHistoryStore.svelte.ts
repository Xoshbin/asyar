import { logService } from "../../log/logService";
import { diagnosticsService } from "../../diagnostics/diagnosticsService.svelte";
import type { ClipboardHistoryItem } from "asyar-sdk/contracts";
import {
  clipboardListInitial,
  clipboardListOlder,
  clipboardSearch,
  clipboardGetItem,
  clipboardRecordCapture,
  clipboardToggleFavorite,
  clipboardDeleteItem,
  clipboardClearNonFavorites,
  type StoredClipboardItem,
  type StoredClipboardListItem,
  type ClipboardCursor,
  type ClipboardDeleteResult,
  type ClipboardClearResult,
} from "../../../lib/ipc/commands";

export type ClipboardStoreChangeEvent =
  | { type: 'upsert'; itemId: string }
  | { type: 'delete'; itemId: string };

type ListItem = StoredClipboardListItem;

function reportFailure(kind: string, err: unknown): void {
  void diagnosticsService.report({
    source: 'frontend',
    kind,
    severity: 'error',
    retryable: false,
    developerDetail: String(err),
  });
}

export class ClipboardHistoryStoreClass {
  favorites = $state<ListItem[]>([]);
  recent = $state<ListItem[]>([]);
  searchResults = $state<ListItem[] | null>(null);
  indexState = $state<'ready' | 'indexing'>('indexing');
  nextOlderCursor = $state<ClipboardCursor | undefined>(undefined);

  #subscribers = new Set<(event: ClipboardStoreChangeEvent) => void>();

  subscribe(callback: (event: ClipboardStoreChangeEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => { this.#subscribers.delete(callback); };
  }

  #notify(event: ClipboardStoreChangeEvent): void {
    this.#subscribers.forEach((cb) => {
      try { cb(event); }
      catch (err) {
        logService.warn(`clipboardHistoryStore subscriber threw: ${err}`);
      }
    });
  }

  reset(): void {
    this.favorites = [];
    this.recent = [];
    this.searchResults = null;
    this.indexState = 'indexing';
    this.nextOlderCursor = undefined;
  }

  async loadInitial(limit = 100): Promise<void> {
    try {
      const page = await clipboardListInitial(limit);
      this.favorites = page.favorites;
      this.recent = page.recent;
      this.nextOlderCursor = page.nextCursor;
    } catch (err) {
      reportFailure('clipboard/load-failed', err);
    }
  }

  // Guards against concurrent loadOlder calls. Without this, fast scrolling
  // fires the scroll handler dozens of times per second, each spawning its
  // own IPC + array-spread. Result: same page appended N times, recent
  // array grows unboundedly, webview eventually OOMs and the app crashes.
  #loadingOlder = false;

  async loadOlder(limit = 200): Promise<void> {
    if (this.#loadingOlder || !this.nextOlderCursor) return;
    this.#loadingOlder = true;
    try {
      const cursor = this.nextOlderCursor;
      const page = await clipboardListOlder(cursor, limit);
      this.recent = [...this.recent, ...page.items];
      this.nextOlderCursor = page.nextCursor;
    } catch (err) {
      reportFailure('clipboard/load-older-failed', err);
    } finally {
      this.#loadingOlder = false;
    }
  }

  // Monotonic sequence number used to drop stale search responses.
  // Without it, typing "apple" launches 5 IPCs (one per keystroke); they
  // queue on Tauri's worker pool and race to write `searchResults`. The
  // user perceives this as "search takes a long time" because each
  // intermediate write triggers a re-render of the result list. With
  // this guard, only the latest issued query's response is applied —
  // earlier in-flight responses are dropped before they touch the UI.
  #searchSeq = 0;

  async search(query: string, limit = 200): Promise<void> {
    const mySeq = ++this.#searchSeq;
    try {
      const res = await clipboardSearch(query, limit);
      // Drop response if a newer search has been issued in the meantime.
      if (mySeq !== this.#searchSeq) return;
      this.searchResults = res.items;
      this.indexState = res.indexState;
    } catch (err) {
      reportFailure('clipboard/search-failed', err);
    }
  }

  clearSearch(): void {
    // Bump the sequence so any in-flight search response is dropped on
    // arrival — without this, the user clearing their query could be
    // immediately overwritten by a late-arriving prior search.
    this.#searchSeq++;
    this.searchResults = null;
  }

  async fetchFullItem(id: string): Promise<StoredClipboardItem | null> {
    try {
      return await clipboardGetItem(id);
    } catch (err) {
      reportFailure('clipboard/get-item-failed', err);
      return null;
    }
  }

  async addHistoryItem(item: ClipboardHistoryItem): Promise<void> {
    try {
      const stored = item as unknown as StoredClipboardItem;
      const res = await clipboardRecordCapture(stored);
      if (res.evictedIds.length > 0) {
        const evicted = new Set(res.evictedIds);
        this.recent = this.recent.filter((i) => !evicted.has(i.id));
        this.favorites = this.favorites.filter((i) => !evicted.has(i.id));
      }
      const newRow: ListItem = {
        id: stored.id,
        type: stored.type,
        preview: stored.preview,
        createdAt: stored.createdAt,
        favorite: stored.favorite,
        metadata: stored.metadata,
        sourceApp: stored.sourceApp,
        redactedKinds: stored.redactedKinds,
      };
      if (newRow.favorite) {
        this.favorites = [newRow, ...this.favorites.filter((i) => i.id !== newRow.id)];
      } else {
        this.recent = [newRow, ...this.recent.filter((i) => i.id !== newRow.id)];
      }
      this.#notify({ type: 'upsert', itemId: stored.id });
    } catch (err) {
      reportFailure('clipboard/capture-failed', err);
    }
  }

  async toggleFavorite(id: string): Promise<void> {
    try {
      const newFavorite = await clipboardToggleFavorite(id);

      // Find the row anywhere in the loaded windows so we can move it.
      const source =
        this.recent.find((i) => i.id === id) ??
        this.favorites.find((i) => i.id === id) ??
        this.searchResults?.find((i) => i.id === id);

      if (source) {
        const updated = { ...source, favorite: newFavorite };
        if (newFavorite) {
          this.recent = this.recent.filter((i) => i.id !== id);
          this.favorites = [updated, ...this.favorites.filter((i) => i.id !== id)];
        } else {
          this.favorites = this.favorites.filter((i) => i.id !== id);
          this.recent = [updated, ...this.recent.filter((i) => i.id !== id)];
        }
      }

      if (this.searchResults) {
        this.searchResults = this.searchResults.map((i) =>
          i.id === id ? { ...i, favorite: newFavorite } : i
        );
      }
      this.#notify({ type: 'upsert', itemId: id });
    } catch (err) {
      reportFailure('clipboard/favorite-failed', err);
    }
  }

  async deleteHistoryItem(id: string): Promise<ClipboardDeleteResult> {
    try {
      const res = await clipboardDeleteItem(id);
      this.favorites = this.favorites.filter((i) => i.id !== id);
      this.recent = this.recent.filter((i) => i.id !== id);
      if (this.searchResults) {
        this.searchResults = this.searchResults.filter((i) => i.id !== id);
      }
      this.#notify({ type: 'delete', itemId: id });
      return res;
    } catch (err) {
      reportFailure('clipboard/delete-failed', err);
      return { imageContentPath: undefined };
    }
  }

  async clearHistory(): Promise<ClipboardClearResult> {
    try {
      const res = await clipboardClearNonFavorites();
      const removed = new Set(res.removedIds);
      this.recent = this.recent.filter((i) => !removed.has(i.id));
      if (this.searchResults) {
        this.searchResults = this.searchResults.filter((i) => !removed.has(i.id));
      }
      res.removedIds.forEach((rid) => this.#notify({ type: 'delete', itemId: rid }));
      return res;
    } catch (err) {
      reportFailure('clipboard/clear-failed', err);
      return { removedIds: [], removedImagePaths: [] };
    }
  }
}

export const clipboardHistoryStore = new ClipboardHistoryStoreClass();
