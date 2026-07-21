/**
 * Read/write access to the user's Notes. No update/delete by design —
 * extensions can only add content (create/append), never overwrite or delete
 * a note they don't own. Reads need `notes:read`; writes need `notes:write`.
 */

export interface NoteSearchHit {
  id: string;
  title: string;
  /** A short excerpt of the note body, not the full content — call `get(id)` for that. */
  snippet: string;
}

export interface NoteDetail {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  updatedAt: number;
}

export interface INotesService {
  /** Full-text search over note titles and bodies. */
  search(query: string, limit?: number): Promise<NoteSearchHit[]>;

  /** The user's most recent notes (pinned first, then newest-edited first), no query. */
  list(limit?: number): Promise<NoteSearchHit[]>;

  /** Fetch one note's full content by id or exact (case-insensitive) title. Null if not found. */
  get(idOrTitle: string): Promise<NoteDetail | null>;

  /** Create a new note. `body` defaults to empty. */
  create(title: string, body?: string): Promise<{ id: string; title: string }>;

  /** Append a line of text to an existing note, found by id or exact (case-insensitive) title. */
  append(idOrTitle: string, text: string): Promise<{ id: string; title: string }>;
}
