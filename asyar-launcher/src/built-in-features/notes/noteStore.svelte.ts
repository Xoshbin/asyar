import {
  noteUpsert,
  noteGetAll,
  noteRemove,
  noteTogglePin,
  noteUpdate,
  type StoredNote,
} from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

function reportPersistenceFailure(action: string, err: unknown): void {
  logService.error(`[NoteStore] ${action}: ${err}`);
  feedbackService.report({
    source: 'frontend',
    kind: 'manual',
    severity: 'warning',
    retryable: false,
    context: { message: `Note ${action.toLowerCase()} — change may not survive restart` },
  });
}

export type Note = StoredNote;

/**
 * Local change event emitted by the store on add/update/remove/pin. Used by
 * the cloud sync delta provider to mark items dirty for the next push.
 */
export type NoteStoreChangeEvent =
  { type: 'upsert'; itemId: string } | { type: 'delete'; itemId: string };

class NoteStoreClass {
  notes = $state<Note[]>([]);
  #initialized = false;
  #subscribers = new Set<(event: NoteStoreChangeEvent) => void>();

  subscribe(callback: (event: NoteStoreChangeEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notify(event: NoteStoreChangeEvent): void {
    this.#subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        logService.warn(`noteStore subscriber threw: ${err}`);
      }
    });
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;

    try {
      const data = await noteGetAll();
      this.notes = data ?? [];
    } catch {
      // Keep empty default
    }
  }

  getAll(): Note[] {
    return this.notes;
  }

  add(note: Note) {
    this.notes = [note, ...this.notes.filter((n) => n.id !== note.id)];
    noteUpsert(note).catch((err) => reportPersistenceFailure('Failed to save', err));
    this.#notify({ type: 'upsert', itemId: note.id });
  }

  /**
   * Apply a partial edit locally and persist it. `updatedAt` is stamped
   * here (the frontend's clock) — the Rust storage layer stays a pure
   * function of its arguments rather than reaching for its own clock.
   */
  update(id: string, changes: { title?: string; body?: string; pinned?: boolean }) {
    const updatedAt = Date.now();
    this.notes = this.notes.map((n) => (n.id === id ? { ...n, ...changes, updatedAt } : n));
    noteUpdate(id, changes, updatedAt).catch((err) =>
      reportPersistenceFailure('Failed to update', err),
    );
    this.#notify({ type: 'upsert', itemId: id });
  }

  remove(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    noteRemove(id).catch((err) => reportPersistenceFailure('Failed to delete', err));
    this.#notify({ type: 'delete', itemId: id });
  }

  togglePin(id: string) {
    this.notes = this.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n));
    noteTogglePin(id).catch((err) => reportPersistenceFailure('Failed to toggle pin', err));
    this.#notify({ type: 'upsert', itemId: id });
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const noteStore = new NoteStoreClass();
