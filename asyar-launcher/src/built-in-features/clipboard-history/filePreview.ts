import { getFileThumbnail } from '../../lib/ipc/thumbnailCommands';

/**
 * Upper bound on thumbnails requested for one `files` clipboard entry.
 * On macOS every non-image type is thumbnailed through a `qlmanage`
 * subprocess, so copying a folder full of files must not spawn one
 * generation per file the user only glances at.
 */
export const MAX_FILE_THUMBNAILS = 12;

/** Detail-pane thumbnail size, matching file-search's detail preview. */
export const FILE_THUMB_DIM = 800;

/** Loader signature — injectable so the batching logic stays unit-testable. */
export type ThumbnailLoader = (path: string, maxDim: number) => Promise<string | null>;

/** Paths held by a `files` item, whose content is a JSON string array. */
export function parseFilePaths(content: string | null | undefined): string[] {
  if (!content) return [];
  try {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed as unknown[];
    // TS infers a type predicate for the callback, narrowing `entries` to
    // string[] in the true branch — no assertion needed.
    return entries.every((p) => typeof p === 'string') ? entries : [];
  } catch {
    return [];
  }
}

/** Last path segment, handling both POSIX and Windows separators. */
export function fileNameOf(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || path;
}

/**
 * Resolves an `asyar-thumb://` URL per path. Entries stay `null` when the
 * backend has no thumbnail strategy for that file type (or the generation
 * failed) — callers keep their file-icon fallback for those.
 */
export async function loadFileThumbnails(
  paths: string[],
  maxDim: number = FILE_THUMB_DIM,
  load: ThumbnailLoader = getFileThumbnail,
): Promise<Record<string, string | null>> {
  const distinct = [...new Set(paths)].slice(0, MAX_FILE_THUMBNAILS);
  const urls = await Promise.all(distinct.map((path) => load(path, maxDim).catch(() => null)));
  return Object.fromEntries(distinct.map((path, i) => [path, urls[i]]));
}
