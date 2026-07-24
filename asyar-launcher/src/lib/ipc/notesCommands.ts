// asyar-launcher/src/lib/ipc/notesCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

// ── Storage: Notes ───────────────────────────────────────────────────────────

export interface StoredNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

export interface NoteSearchResult {
  items: StoredNote[];
  indexState: 'ready' | 'indexing';
}

export async function noteUpsert(note: StoredNote): Promise<void> {
  await invokeSafe('note_upsert', { note });
}

export async function noteGetAll(): Promise<StoredNote[] | null> {
  return invokeSafe<StoredNote[]>('note_get_all');
}

export async function noteGetById(id: string): Promise<StoredNote | null> {
  return invokeSafe<StoredNote | null>('note_get_by_id', { id });
}

export async function noteUpdate(
  id: string,
  changes: { title?: string; body?: string; pinned?: boolean },
  updatedAt: number,
): Promise<void> {
  await invokeSafe('note_update', {
    id,
    title: changes.title ?? null,
    body: changes.body ?? null,
    pinned: changes.pinned ?? null,
    updatedAt,
  });
}

export async function noteRemove(id: string): Promise<void> {
  await invokeSafe('note_remove', { id });
}

export async function noteTogglePin(id: string): Promise<boolean | null> {
  return invokeSafe<boolean>('note_toggle_pin', { id });
}

export async function noteSearch(query: string, limit = 50): Promise<NoteSearchResult | null> {
  return invokeSafe<NoteSearchResult>('note_search', { query, limit });
}

export async function noteFind(idOrTitle: string): Promise<StoredNote | null> {
  return invokeSafe<StoredNote | null>('note_find', { idOrTitle });
}

export async function noteBacklinks(idOrTitle: string): Promise<StoredNote[] | null> {
  return invokeSafe<StoredNote[]>('note_backlinks', { idOrTitle });
}

/** Save a note as a .md file (prompts for location) and reveal it. Returns
 *  the saved path, or null if the user cancelled the dialog. */
export async function noteExportMarkdown(id: string): Promise<string | null> {
  return invokeSafe<string | null>('note_export_markdown', { id });
}

// ── Sticky notes (one always-on-top window per pinned note) ──────────────────

export interface StickyNote {
  noteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
}

/** Pin a note to the desktop — opens (or focuses) its sticky window. */
export async function stickyOpen(noteId: string): Promise<void> {
  await invokeSafe('sticky_open', { noteId });
}

/** Unpin — closes the sticky window and forgets its geometry. */
export async function stickyClose(noteId: string): Promise<void> {
  await invokeSafe('sticky_close', { noteId });
}

/** Create a new empty note and stick it to the desktop. Returns its id. */
export async function stickyNew(): Promise<string | null> {
  return invokeSafe<string>('sticky_new');
}

// Manual window dragging. `data-tauri-drag-region` relies on the native
// startDragging path, which isn't dependable for the NSPanel-converted sticky
// windows on macOS — anchor-plus-offset works the same on every platform.
export async function stickyDragStart(noteId: string): Promise<void> {
  await invokeSafe('sticky_drag_start', { noteId });
}

export async function stickyDragMove(noteId: string, dx: number, dy: number): Promise<void> {
  await invokeSafe('sticky_drag_move', { noteId, dx, dy });
}

export async function stickyDragEnd(noteId: string): Promise<void> {
  await invokeSafe('sticky_drag_end', { noteId });
}

export async function stickyIsStuck(noteId: string): Promise<boolean | null> {
  return invokeSafe<boolean>('sticky_is_stuck', { noteId });
}

export async function stickyList(): Promise<StickyNote[] | null> {
  return invokeSafe<StickyNote[]>('sticky_list');
}
