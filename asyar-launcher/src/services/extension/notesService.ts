import { noteSearch as noteSearchIpc } from '../../lib/ipc/commands';
import { noteStore, type Note } from '../../built-in-features/notes/noteStore.svelte';
import type { NoteSearchHit, NoteDetail } from 'asyar-sdk/contracts';

function snippetOf(body: string, maxChars = 160): string {
  const trimmed = body.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

function toHit(note: Note): NoteSearchHit {
  return { id: note.id, title: note.title, snippet: snippetOf(note.body) };
}

/** Pinned notes first, then newest-edited first within each group. */
function sortedNotes(): Note[] {
  const all = noteStore.getAll();
  const byUpdatedDesc = (a: Note, b: Note) => b.updatedAt - a.updatedAt;
  const pinned = all.filter((n) => n.pinned).sort(byUpdatedDesc);
  const rest = all.filter((n) => !n.pinned).sort(byUpdatedDesc);
  return [...pinned, ...rest];
}

function findByIdOrTitle(idOrTitle: string): Note | undefined {
  const all = noteStore.getAll();
  const byId = all.find((n) => n.id === idOrTitle);
  if (byId) return byId;
  const needle = idOrTitle.trim().toLowerCase();
  return all.find((n) => n.title.trim().toLowerCase() === needle);
}

/**
 * Host-side implementation dispatched by the IPC router when extensions call
 * `context.notes.*`. `notes:read`/`notes:write` permission-gated in Rust
 * (`permissions.rs::get_required_permission`) before any of these run — see
 * `INotesService` in the SDK for the write-primitives-only-add rationale.
 * `extensionId` (the router's positional first arg) is unused: notes aren't
 * per-extension-isolated data like `extensionStorageService`'s KV store —
 * an extension-created note is a real, first-class note the user sees and
 * edits in their own Notes view.
 */
export const notesService = {
  async search(_extensionId: string, query: string, limit?: number): Promise<NoteSearchHit[]> {
    const result = await noteSearchIpc(query, limit ?? 10);
    return (result?.items ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      snippet: snippetOf(n.body),
    }));
  },

  async list(_extensionId: string, limit?: number): Promise<NoteSearchHit[]> {
    return sortedNotes()
      .slice(0, limit ?? 20)
      .map(toHit);
  },

  async get(_extensionId: string, idOrTitle: string): Promise<NoteDetail | null> {
    const note = findByIdOrTitle(idOrTitle);
    if (!note) return null;
    return {
      id: note.id,
      title: note.title,
      body: note.body,
      pinned: note.pinned,
      updatedAt: note.updatedAt,
    };
  },

  async create(
    _extensionId: string,
    title: string,
    body?: string,
  ): Promise<{ id: string; title: string }> {
    const now = Date.now();
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      body: body ?? '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    noteStore.add(note);
    return { id: note.id, title: note.title };
  },

  async append(
    _extensionId: string,
    idOrTitle: string,
    text: string,
  ): Promise<{ id: string; title: string }> {
    const note = findByIdOrTitle(idOrTitle);
    if (!note) throw new Error(`No note matching "${idOrTitle}"`);
    const newBody = note.body.trim() ? `${note.body}\n${text}` : text;
    noteStore.update(note.id, { body: newBody });
    return { id: note.id, title: note.title };
  },
};
