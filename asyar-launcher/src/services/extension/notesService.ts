import {
  noteSearchForService,
  noteGetAllForService,
  noteFindForService,
  noteUpsert,
  noteUpdate,
  type StoredNote,
} from '../../lib/ipc/commands';
import type { NoteSearchHit, NoteDetail } from 'asyar-sdk/contracts';

/** Display-only preview truncation (same category as formatting a date). */
function snippetOf(body: string, maxChars = 160): string {
  const trimmed = body.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

function toHit(note: StoredNote): NoteSearchHit {
  return { id: note.id, title: note.title, snippet: snippetOf(note.body) };
}

// Host dispatch for extension `context.notes.*` (gated in Rust). Reads and writes
// go directly to the platform storage/Rust commands (ordering, lookup, SQLite
// persistence, encryption, and FTS indexing are Rust's job). Rust automatically
// emits `notes:changed` to synchronize any active Notes or sticky-note views.
// No extensionId param → `notes` is NOT in INJECTS_EXTENSION_ID.
export const notesService = {
  async search(query: string, limit?: number): Promise<NoteSearchHit[]> {
    const result = await noteSearchForService(query, limit ?? 10);
    return result.items.map(toHit);
  },

  async list(limit?: number): Promise<NoteSearchHit[]> {
    const all = await noteGetAllForService();
    return all.slice(0, limit ?? 20).map(toHit);
  },

  async get(idOrTitle: string): Promise<NoteDetail | null> {
    const note = await noteFindForService(idOrTitle);
    if (!note) return null;
    return {
      id: note.id,
      title: note.title,
      body: note.body,
      pinned: note.pinned,
      updatedAt: note.updatedAt,
    };
  },

  async create(title: string, body?: string): Promise<{ id: string; title: string }> {
    const now = Date.now();
    const note: StoredNote = {
      id: crypto.randomUUID(),
      title,
      body: body ?? '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    await noteUpsert(note);
    return { id: note.id, title: note.title };
  },

  async append(idOrTitle: string, text: string): Promise<{ id: string; title: string }> {
    const note = await noteFindForService(idOrTitle);
    if (!note) throw new Error(`No note matching "${idOrTitle}"`);
    const newBody = note.body.trim() ? `${note.body}\n${text}` : text;
    await noteUpdate(note.id, { body: newBody }, Date.now());
    return { id: note.id, title: note.title };
  },
};
