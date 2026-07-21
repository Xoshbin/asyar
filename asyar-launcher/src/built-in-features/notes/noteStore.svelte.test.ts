/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  noteUpsert: vi.fn().mockResolvedValue(undefined),
  // Default null so togglePin's post-persist reorder (which calls noteGetAll)
  // is a no-op in tests that don't exercise it; tests that do override it.
  noteGetAll: vi.fn(async () => null),
  noteRemove: vi.fn().mockResolvedValue(undefined),
  noteTogglePin: vi.fn().mockResolvedValue(undefined),
  noteUpdate: vi.fn().mockResolvedValue(undefined),
}));

import { noteStore } from './noteStore.svelte';
import { noteGetAll, noteUpdate } from '../../lib/ipc/commands';

function makeNote(id: string, title: string, body: string, updatedAt = 0) {
  return { id, title, body, createdAt: 0, updatedAt, pinned: false };
}

describe('noteStore', () => {
  beforeEach(() => {
    noteStore.notes = [];
    vi.mocked(noteUpdate).mockClear();
  });

  it('add() inserts a note at the front', () => {
    noteStore.add(makeNote('1', 'A', 'alpha'));
    expect(noteStore.notes).toHaveLength(1);
    expect(noteStore.notes[0].title).toBe('A');
  });

  it('add() replaces a note with the same id', () => {
    noteStore.add(makeNote('1', 'A', 'alpha'));
    noteStore.add(makeNote('1', 'A updated', 'alpha2'));
    expect(noteStore.notes).toHaveLength(1);
    expect(noteStore.notes[0].body).toBe('alpha2');
  });

  it('remove() deletes a note', () => {
    noteStore.add(makeNote('1', 'A', 'alpha'));
    noteStore.add(makeNote('2', 'B', 'beta'));
    noteStore.remove('1');
    expect(noteStore.notes).toHaveLength(1);
    expect(noteStore.notes[0].id).toBe('2');
  });

  it('togglePin() flips pinned state optimistically', () => {
    noteStore.add(makeNote('1', 'A', 'alpha'));
    expect(noteStore.notes[0].pinned).toBe(false);
    noteStore.togglePin('1');
    expect(noteStore.notes[0].pinned).toBe(true);
    noteStore.togglePin('1');
    expect(noteStore.notes[0].pinned).toBe(false);
  });

  it('togglePin() reorders the list from Rust after the toggle persists', async () => {
    noteStore.notes = [makeNote('1', 'A', 'a'), makeNote('2', 'B', 'b')];
    // Rust returns the reordered rows — pinned '2' now leads.
    vi.mocked(noteGetAll).mockResolvedValueOnce([
      { ...makeNote('2', 'B', 'b'), pinned: true },
      makeNote('1', 'A', 'a'),
    ]);

    noteStore.togglePin('2');
    await new Promise((r) => setTimeout(r, 0)); // flush toggle IPC + reorder refetch

    expect(noteStore.notes.map((n) => n.id)).toEqual(['2', '1']);
    expect(noteStore.notes[0].pinned).toBe(true);
  });

  it('update() merges changes and stamps updatedAt', () => {
    noteStore.add(makeNote('1', 'A', 'alpha', 100));
    noteStore.update('1', { body: 'updated body' });
    expect(noteStore.notes[0].body).toBe('updated body');
    expect(noteStore.notes[0].title).toBe('A'); // unchanged
    expect(noteStore.notes[0].updatedAt).toBeGreaterThan(100);
  });

  it('update() persists via noteUpdate with the merged changes and a timestamp', () => {
    noteStore.add(makeNote('1', 'A', 'alpha', 100));
    noteStore.update('1', { title: 'New title' });
    expect(noteUpdate).toHaveBeenCalledWith('1', { title: 'New title' }, expect.any(Number));
  });

  it('getAll() returns all notes', () => {
    noteStore.add(makeNote('1', 'A', 'alpha'));
    noteStore.add(makeNote('2', 'B', 'beta'));
    expect(noteStore.getAll()).toHaveLength(2);
  });

  describe('subscribe()', () => {
    it('notifies subscribers of upsert on add/update/togglePin, and delete on remove', () => {
      const events: Array<{ type: string; itemId: string }> = [];
      const unsub = noteStore.subscribe((ev) => events.push(ev));

      noteStore.add(makeNote('1', 'A', 'alpha'));
      noteStore.update('1', { body: 'updated' });
      noteStore.togglePin('1');
      noteStore.remove('1');

      expect(events).toEqual([
        { type: 'upsert', itemId: '1' },
        { type: 'upsert', itemId: '1' },
        { type: 'upsert', itemId: '1' },
        { type: 'delete', itemId: '1' },
      ]);
      unsub();
    });

    it('stops receiving events after unsubscribing', () => {
      const events: Array<{ type: string; itemId: string }> = [];
      const unsub = noteStore.subscribe((ev) => events.push(ev));
      unsub();

      noteStore.add(makeNote('1', 'A', 'alpha'));
      expect(events).toEqual([]);
    });
  });

  describe('appendToToday()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-21T15:04:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("creates a new note titled with today's date when none exists yet", () => {
      const note = noteStore.appendToToday('did a thing');
      expect(note.title).toBe('2026-07-21');
      expect(note.body).toBe('did a thing');
      expect(noteStore.notes).toHaveLength(1);
    });

    it('appends as a new line to an existing note for today', () => {
      noteStore.appendToToday('first thing');
      const note = noteStore.appendToToday('second thing');
      expect(noteStore.notes).toHaveLength(1); // same note, not a second one
      expect(note.body).toBe('first thing\nsecond thing');
    });

    it('does not touch a note from a different day with a similar title', () => {
      noteStore.add(makeNote('old', '2026-07-20', 'yesterday'));
      const note = noteStore.appendToToday('today thing');
      expect(noteStore.notes).toHaveLength(2);
      expect(note.title).toBe('2026-07-21');
      expect(note.body).toBe('today thing');
    });
  });

  describe('reload()', () => {
    it('re-fetches from DB and replaces stale in-memory state', async () => {
      noteStore.notes = [makeNote('stale', 'Stale', 'old')];
      vi.mocked(noteGetAll).mockResolvedValueOnce([makeNote('fresh', 'Fresh', 'new')]);

      await noteStore.reload();

      expect(noteGetAll).toHaveBeenCalled();
      expect(noteStore.notes).toHaveLength(1);
      expect(noteStore.notes[0].id).toBe('fresh');
    });

    it('allows init() to run again after the store was already initialized', async () => {
      vi.mocked(noteGetAll).mockResolvedValue([]);
      await noteStore.init(); // marks initialized

      const callsBefore = vi.mocked(noteGetAll).mock.calls.length;
      await noteStore.reload();
      expect(vi.mocked(noteGetAll).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
