import {
  snippetUpsert,
  snippetGetAll,
  snippetRemove,
  snippetTogglePin,
  snippetClearAll,
} from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';

function reportPersistenceFailure(action: string, err: unknown): void {
  logService.error(`[SnippetStore] ${action}: ${err}`);
  diagnosticsService.report({
    source: 'frontend', kind: 'manual', severity: 'warning',
    retryable: false,
    context: { message: `Snippet ${action.toLowerCase()} — change may not survive restart` },
  });
}

export interface Snippet {
  id: string;
  keyword?: string;   // e.g. ";addr" — what the user types (lowercase + symbols); optional
  expansion: string;  // e.g. "123 Main St, Springfield"
  name: string;       // display label
  createdAt: number;
  pinned?: boolean;
  /**
   * Set when the secret redactor matched on save. Each entry is a kind name
   * from the bundled detector catalog. The original (pre-redaction) value
   * of `expansion` is not stored.
   */
  redactedKinds?: string[];
}

/**
 * Local change event emitted by the store on add/update/remove. Used by
 * the cloud sync delta provider to mark items dirty for the next push.
 */
export type SnippetStoreChangeEvent =
  | { type: 'upsert'; itemId: string }
  | { type: 'delete'; itemId: string };

class SnippetStoreClass {
  snippets = $state<Snippet[]>([]);
  #initialized = false;
  #subscribers = new Set<(event: SnippetStoreChangeEvent) => void>();

  subscribe(callback: (event: SnippetStoreChangeEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notify(event: SnippetStoreChangeEvent): void {
    this.#subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        logService.warn(`snippetStore subscriber threw: ${err}`);
      }
    });
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;

    try {
      const data = await snippetGetAll();
      this.snippets = data as Snippet[];
    } catch {
      // Keep empty default
    }
  }

  getAll(): Snippet[] {
    return this.snippets;
  }

  add(snippet: Snippet) {
    this.snippets = [...this.snippets.filter(s => s.id !== snippet.id), snippet];
    snippetUpsert(snippet as any).catch(err => reportPersistenceFailure('Failed to save', err));
    this.#notify({ type: 'upsert', itemId: snippet.id });
  }

  update(id: string, changes: Partial<Snippet>) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, ...changes } : s);
    const updated = this.snippets.find(s => s.id === id);
    if (updated) snippetUpsert(updated as any).catch(err => reportPersistenceFailure('Failed to update', err));
    this.#notify({ type: 'upsert', itemId: id });
  }

  remove(id: string) {
    this.snippets = this.snippets.filter(s => s.id !== id);
    snippetRemove(id).catch(err => reportPersistenceFailure('Failed to delete', err));
    this.#notify({ type: 'delete', itemId: id });
  }

  togglePin(id: string) {
    this.snippets = this.snippets.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s);
    snippetTogglePin(id).catch(err => reportPersistenceFailure('Failed to toggle pin', err));
    this.#notify({ type: 'upsert', itemId: id });
  }

  clearAll() {
    const removedIds = this.snippets.map(s => s.id);
    this.snippets = [];
    snippetClearAll().catch(err => reportPersistenceFailure('Failed to clear all', err));
    removedIds.forEach((id) => this.#notify({ type: 'delete', itemId: id }));
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const snippetStore = new SnippetStoreClass();
