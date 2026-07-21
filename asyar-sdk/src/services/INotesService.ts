/**
 * Read/write access to the user's Notes (the built-in Notes feature — see
 * `built-in-features/notes/` in the launcher).
 *
 * Deliberately narrower than a full CRUD interface: extensions can search,
 * read, create, and append to notes, but can never overwrite an existing
 * note's title/body in place or delete a note by id. This means a buggy or
 * malicious extension cannot silently corrupt or destroy a note the user (or
 * another extension) already wrote — the worst it can do is add content.
 * `create`/`append` are intentionally the same two write primitives the AI
 * agent's built-in `notes-create`/`notes-append` tools use, so there is one
 * consistent mental model for "how does anything write to Notes."
 *
 * `search`/`list`/`get` require `notes:read`; `create`/`append` require
 * `notes:write`, both declared in manifest.json.
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
