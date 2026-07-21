### 8.37 `NotesService` — Search, read, create, and append to the user's Notes

**Runs in:** both worker and view.

**Permission required:** `notes:read` for `search()`/`list()`/`get()`, `notes:write` for `create()`/`append()`.

Lets an extension plug into the user's built-in Notes feature instead of building its own storage — a web-clipper extension can save an article as a real note the user sees and edits in their own Notes view, not a hidden extension-private copy.

Deliberately narrower than a full CRUD interface: there is no `update()` or `delete()`. An extension can create new notes and append to existing ones, but can never overwrite an existing note's title/body in place or remove a note by id — a buggy or malicious extension cannot silently corrupt or destroy a note it doesn't own. `create`/`append` are the same two write primitives the AI agent's built-in `notes-create`/`notes-append` tools use, so there is one consistent mental model for "how does anything write to Notes."

```typescript
interface NoteSearchHit {
  id: string;
  title: string;
  snippet: string; // short excerpt, not the full body
}

interface NoteDetail {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  updatedAt: number;
}

interface INotesService {
  search(query: string, limit?: number): Promise<NoteSearchHit[]>;
  list(limit?: number): Promise<NoteSearchHit[]>;
  get(idOrTitle: string): Promise<NoteDetail | null>;
  create(title: string, body?: string): Promise<{ id: string; title: string }>;
  append(idOrTitle: string, text: string): Promise<{ id: string; title: string }>;
}
```

**Usage:**

```typescript
const notes = context.getService<INotesService>('notes');

// Full-text search over title + body
const hits = await notes.search('roadmap', 5);

// Browse recent notes (pinned first, then newest-edited) with no query
const recent = await notes.list(10);

// Fetch full content — by id (from search/list) or by exact title
const note = await notes.get(hits[0]?.id ?? 'Daily Log');

// Create a new note
const created = await notes.create('Article: Example', 'Clipped from example.com...');

// Append to an existing note, found by id or title
await notes.append('Daily Log', `${new Date().toLocaleTimeString()}: did a thing`);
```

**`get`/`append` accept an id or a title:** both look up by exact id first, then fall back to a case-insensitive exact title match. This matters because the user's own chat messages and your own extension's context usually name a note by title, not id — you don't need to `search`/`list` first just to resolve an id you already effectively know.

**How it works under the hood:** notes are stored encrypted at rest and full-text indexed the same way as every other note, regardless of whether they were created by the user or by an extension — there is no separate "extension notes" storage. `search()` is backed by the same Rust FTS5 index the built-in Notes UI uses.

---
