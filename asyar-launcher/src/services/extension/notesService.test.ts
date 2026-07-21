import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNoteSearch = vi.fn();
const mockNoteGetAll = vi.fn();
const mockNoteFind = vi.fn();
vi.mock('../../lib/ipc/commands', () => ({
  noteSearch: (...args: unknown[]) => mockNoteSearch(...args),
  noteGetAll: (...args: unknown[]) => mockNoteGetAll(...args),
  noteFind: (...args: unknown[]) => mockNoteFind(...args),
}));

vi.mock('../../built-in-features/notes/noteStore.svelte', () => ({
  noteStore: {
    add: vi.fn(),
    update: vi.fn(),
  },
}));

import { notesService } from './notesService';
import { noteStore } from '../../built-in-features/notes/noteStore.svelte';

function note(id: string, title: string, body: string, extra: Partial<any> = {}) {
  return { id, title, body, createdAt: 1000, updatedAt: 1000, pinned: false, ...extra };
}

describe('notesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('search', () => {
    it('calls the Rust FTS search and maps results to id/title/snippet', async () => {
      mockNoteSearch.mockResolvedValue({
        items: [note('1', 'Grocery List', 'buy milk and eggs')],
        indexState: 'ready',
      });
      const results = await notesService.search('milk', 5);
      expect(mockNoteSearch).toHaveBeenCalledWith('milk', 5);
      expect(results).toEqual([{ id: '1', title: 'Grocery List', snippet: 'buy milk and eggs' }]);
    });

    it('defaults limit to 10 and returns [] when nothing found', async () => {
      mockNoteSearch.mockResolvedValue({ items: [], indexState: 'ready' });
      const results = await notesService.search('nothing');
      expect(mockNoteSearch).toHaveBeenCalledWith('nothing', 10);
      expect(results).toEqual([]);
    });

    it('truncates a long body into a short snippet', async () => {
      mockNoteSearch.mockResolvedValue({
        items: [note('1', 'Long', 'x'.repeat(300))],
        indexState: 'ready',
      });
      const [hit] = await notesService.search('x');
      expect(hit.snippet.length).toBeLessThan(300);
      expect(hit.snippet.endsWith('…')).toBe(true);
    });
  });

  describe('list', () => {
    it('returns the Rust-ordered list (no frontend re-sort), capped at limit', async () => {
      // Rust already returns pinned-first, newest-first; the service must not reorder.
      mockNoteGetAll.mockResolvedValue([
        note('pinned', 'Pinned', 'c', { pinned: true }),
        note('new', 'New', 'b'),
        note('old', 'Old', 'a'),
      ]);
      const results = await notesService.list(2);
      expect(results.map((r) => r.id)).toEqual(['pinned', 'new']);
    });

    it('defaults limit to 20', async () => {
      mockNoteGetAll.mockResolvedValue([note('1', 'A', 'a')]);
      const results = await notesService.list();
      expect(results).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('resolves via the Rust note_find command and returns full detail', async () => {
      mockNoteFind.mockResolvedValue(note('1', 'Grocery List', 'buy milk'));
      const detail = await notesService.get('grocery list');
      expect(mockNoteFind).toHaveBeenCalledWith('grocery list');
      expect(detail).toMatchObject({ id: '1', title: 'Grocery List', body: 'buy milk' });
    });

    it('returns null when Rust finds nothing', async () => {
      mockNoteFind.mockResolvedValue(null);
      expect(await notesService.get('nope')).toBeNull();
    });
  });

  describe('create', () => {
    it('adds a new note via noteStore.add and returns its id/title', async () => {
      const result = await notesService.create('Idea', 'build a launcher');
      expect(noteStore.add).toHaveBeenCalledTimes(1);
      const added = (noteStore.add as any).mock.calls[0][0];
      expect(added.title).toBe('Idea');
      expect(added.body).toBe('build a launcher');
      expect(result).toEqual({ id: added.id, title: 'Idea' });
    });

    it('defaults body to empty string when omitted', async () => {
      await notesService.create('Just a title');
      expect((noteStore.add as any).mock.calls[0][0].body).toBe('');
    });
  });

  describe('append', () => {
    it('resolves the target via Rust, then appends via noteStore.update', async () => {
      mockNoteFind.mockResolvedValue(note('1', 'Daily Log', '9am: started work'));
      const result = await notesService.append('daily log', '10am: standup');
      expect(mockNoteFind).toHaveBeenCalledWith('daily log');
      expect(noteStore.update).toHaveBeenCalledWith('1', {
        body: '9am: started work\n10am: standup',
      });
      expect(result).toEqual({ id: '1', title: 'Daily Log' });
    });

    it('throws when Rust finds no matching note', async () => {
      mockNoteFind.mockResolvedValue(null);
      await expect(notesService.append('nope', 'x')).rejects.toThrow();
    });
  });
});
