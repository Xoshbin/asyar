/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  noteUpsert: vi.fn().mockResolvedValue(undefined),
  noteGetAll: vi.fn(async () => []),
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

  it('togglePin() flips pinned state', () => {
    noteStore.add(makeNote('1', 'A', 'alpha'));
    expect(noteStore.notes[0].pinned).toBe(false);
    noteStore.togglePin('1');
    expect(noteStore.notes[0].pinned).toBe(true);
    noteStore.togglePin('1');
    expect(noteStore.notes[0].pinned).toBe(false);
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
