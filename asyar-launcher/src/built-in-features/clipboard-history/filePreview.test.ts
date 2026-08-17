import { describe, it, expect, vi } from 'vitest';
import { parseFilePaths, fileNameOf, loadFileThumbnails, MAX_FILE_THUMBNAILS } from './filePreview';

describe('parseFilePaths', () => {
  it('parses the JSON array a files item stores as content', () => {
    expect(parseFilePaths(JSON.stringify(['/a/one.png', '/a/two.pdf']))).toEqual([
      '/a/one.png',
      '/a/two.pdf',
    ]);
  });

  it('returns an empty list for null, empty, or malformed content', () => {
    expect(parseFilePaths(null)).toEqual([]);
    expect(parseFilePaths(undefined)).toEqual([]);
    expect(parseFilePaths('')).toEqual([]);
    expect(parseFilePaths('not json')).toEqual([]);
  });

  it('returns an empty list when the JSON is not an array of strings', () => {
    expect(parseFilePaths('{"a":1}')).toEqual([]);
    expect(parseFilePaths('[1,2]')).toEqual([]);
  });
});

describe('fileNameOf', () => {
  it('takes the last segment of a POSIX path', () => {
    expect(fileNameOf('/Users/k/Screenshots/Snapzy_2026.png')).toBe('Snapzy_2026.png');
  });

  it('takes the last segment of a Windows path', () => {
    expect(fileNameOf('C:\\Users\\k\\shot.png')).toBe('shot.png');
  });

  it('falls back to the input when there is no separator', () => {
    expect(fileNameOf('shot.png')).toBe('shot.png');
  });
});

describe('loadFileThumbnails', () => {
  it('resolves a thumbnail URL per path', async () => {
    const load = vi.fn((p: string) => Promise.resolve(`asyar-thumb://localhost/${fileNameOf(p)}`));
    const result = await loadFileThumbnails(['/a/one.png', '/a/two.png'], 800, load);
    expect(result).toEqual({
      '/a/one.png': 'asyar-thumb://localhost/one.png',
      '/a/two.png': 'asyar-thumb://localhost/two.png',
    });
    expect(load).toHaveBeenCalledWith('/a/one.png', 800);
  });

  it('keeps null for file types the backend has no thumbnail strategy for', async () => {
    const load = vi.fn(() => Promise.resolve(null));
    expect(await loadFileThumbnails(['/a/notes.txt'], 800, load)).toEqual({
      '/a/notes.txt': null,
    });
  });

  it('maps a rejected load to null instead of failing the whole batch', async () => {
    const load = vi.fn((p: string) =>
      p === '/a/bad.png'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve('asyar-thumb://localhost/ok.png'),
    );
    expect(await loadFileThumbnails(['/a/bad.png', '/a/ok.png'], 800, load)).toEqual({
      '/a/bad.png': null,
      '/a/ok.png': 'asyar-thumb://localhost/ok.png',
    });
  });

  it('requests each distinct path only once', async () => {
    const load = vi.fn(() => Promise.resolve('asyar-thumb://localhost/x.png'));
    await loadFileThumbnails(['/a/one.png', '/a/one.png'], 800, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  // On macOS every non-image type goes through a `qlmanage` subprocess, so a
  // clipboard entry holding a whole folder's worth of files must not spawn one
  // generation per file the user never looks at.
  it('caps how many thumbnails a single entry requests', async () => {
    const load = vi.fn(() => Promise.resolve('asyar-thumb://localhost/x.png'));
    const many = Array.from({ length: MAX_FILE_THUMBNAILS + 5 }, (_, i) => `/a/${i}.png`);
    const result = await loadFileThumbnails(many, 800, load);
    expect(load).toHaveBeenCalledTimes(MAX_FILE_THUMBNAILS);
    expect(Object.keys(result)).toHaveLength(MAX_FILE_THUMBNAILS);
  });
});
