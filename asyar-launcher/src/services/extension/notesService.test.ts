import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNoteSearch = vi.fn();
vi.mock('../../lib/ipc/commands', () => ({
  noteSearch: (...args: unknown[]) => mockNoteSearch(...args),
}));

vi.mock('../../built-in-features/notes/noteStore.svelte', () => {
  const notes: any[] = [];
  return {
    noteStore: {
      getAll: () => notes,
      add: vi.fn((note: any) => notes.push(note)),
      update: vi.fn((id: string, changes: any) => {
        const n = notes.find((x) => x.id === id);
        if (n) Object.assign(n, changes, { updatedAt: Date.now() });
      }),
      __notes: notes,
    },
  };
});

import { notesService } from './notesService';
import { noteStore } from '../../built-in-features/notes/noteStore.svelte';

function seed(id: string, title: string, body: string, extra: Partial<any> = {}) {
  (noteStore as any).__notes.push({
    id,
    title,
    body,
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    ...extra,
  });
}

describe('notesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (noteStore as any).__notes.length = 0;
  });

  describe('search', () => {
    it('calls noteSearch IPC and maps results to id/title/snippet', async () => {
      mockNoteSearch.mockResolvedValue({
        items: [{ id: '1', title: 'Grocery List', body: 'buy milk and eggs' }],
        indexState: 'ready',
      });
      const results = await notesService.search('ext.test', 'milk', 5);
      expect(mockNoteSearch).toHaveBeenCalledWith('milk', 5);
      expect(results).toEqual([{ id: '1', title: 'Grocery List', snippet: 'buy milk and eggs' }]);
    });

    it('defaults limit to 10 and returns [] when nothing found', async () => {
      mockNoteSearch.mockResolvedValue({ items: [], indexState: 'ready' });
      const results = await notesService.search('ext.test', 'nothing');
      expect(mockNoteSearch).toHaveBeenCalledWith('nothing', 10);
      expect(results).toEqual([]);
    });

    it('truncates a long body into a short snippet', async () => {
      const longBody = 'x'.repeat(300);
      mockNoteSearch.mockResolvedValue({
        items: [{ id: '1', title: 'Long', body: longBody }],
        indexState: 'ready',
      });
      const [hit] = await notesService.search('ext.test', 'x');
      expect(hit.snippet.length).toBeLessThan(300);
      expect(hit.snippet.endsWith('…')).toBe(true);
    });
  });

  describe('list', () => {
    it('returns pinned notes before unpinned, newest-updated first within each group', async () => {
      seed('1', 'Old unpinned', 'a', { updatedAt: 1000 });
      seed('2', 'New unpinned', 'b', { updatedAt: 3000 });
      seed('3', 'Pinned', 'c', { updatedAt: 500, pinned: true });

      const results = await notesService.list('ext.test');
      expect(results.map((r) => r.id)).toEqual(['3', '2', '1']);
    });

    it('respects limit', async () => {
      seed('1', 'A', 'a');
      seed('2', 'B', 'b');
      seed('3', 'C', 'c');
      const results = await notesService.list('ext.test', 2);
      expect(results).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('finds a note by exact id', async () => {
      seed('1', 'Grocery List', 'buy milk');
      const note = await notesService.get('ext.test', '1');
      expect(note).toMatchObject({ id: '1', title: 'Grocery List', body: 'buy milk' });
    });

    it('falls back to a case-insensitive title match', async () => {
      seed('1', 'Grocery List', 'buy milk');
      const note = await notesService.get('ext.test', 'grocery list');
      expect(note?.id).toBe('1');
    });

    it('returns null when nothing matches', async () => {
      const note = await notesService.get('ext.test', 'nope');
      expect(note).toBeNull();
    });
  });

  describe('create', () => {
    it('adds a new note via noteStore.add and returns its id/title', async () => {
      const result = await notesService.create('ext.test', 'Idea', 'build a launcher');
      expect(noteStore.add).toHaveBeenCalledTimes(1);
      const added = (noteStore as any).__notes[0];
      expect(added.title).toBe('Idea');
      expect(added.body).toBe('build a launcher');
      expect(result).toEqual({ id: added.id, title: 'Idea' });
    });

    it('defaults body to empty string when omitted', async () => {
      await notesService.create('ext.test', 'Just a title');
      expect((noteStore as any).__notes[0].body).toBe('');
    });
  });

  describe('append', () => {
    it('adds text as a new line to an existing note found by id', async () => {
      seed('1', 'Daily Log', '9am: started work');
      const result = await notesService.append('ext.test', '1', '10am: standup');
      expect(noteStore.update).toHaveBeenCalledWith('1', {
        body: '9am: started work\n10am: standup',
      });
      expect(result).toEqual({ id: '1', title: 'Daily Log' });
    });

    it('finds the note by title when no id matches', async () => {
      seed('1', 'Daily Log', '9am: started work');
      await notesService.append('ext.test', 'daily log', '10am: standup');
      expect(noteStore.update).toHaveBeenCalledWith('1', {
        body: '9am: started work\n10am: standup',
      });
    });

    it('throws when no note matches', async () => {
      await expect(notesService.append('ext.test', 'nope', 'x')).rejects.toThrow();
    });
  });
});
