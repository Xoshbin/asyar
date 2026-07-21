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
    // Optimistic flag flip for an instant checkbox; the actual list REORDER
    // (pinned notes lead the list) is Rust's — refetch the ordered rows once
    // the toggle persists rather than re-sorting on the frontend.
    this.notes = this.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n));
    noteTogglePin(id)
      .then(() => this.#reorderFromRust())
      .catch((err) => reportPersistenceFailure('Failed to toggle pin', err));
    this.#notify({ type: 'upsert', itemId: id });
  }

  async #reorderFromRust() {
    const fresh = await noteGetAll();
    if (fresh) this.notes = fresh;
  }

  // Append a line to today's daily note, creating it if absent. Title is the
  // local ISO date ("2026-07-21") — a stable key that re-finds the note
  // tomorrow with no separate id to track.
  appendToToday(text: string): Note {
    const d = new Date();
    const title = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const existing = this.notes.find((n) => n.title === title);
    if (existing) {
      const body = existing.body.trim() ? `${existing.body}\n${text}` : text;
      this.update(existing.id, { body });
      return { ...existing, body, updatedAt: Date.now() };
    }
    const now = Date.now();
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      body: text,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    this.add(note);
    return note;
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const noteStore = new NoteStoreClass();
