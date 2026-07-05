import { invokeSafe } from './invokeSafe';

/** Cached/generated `asyar-thumb://` URL for a file's preview thumbnail,
 * or `null` when this file type/platform has no thumbnail strategy —
 * callers keep their existing type-icon/metadata fallback in that case. */
export async function getFileThumbnail(path: string, maxDim?: number): Promise<string | null> {
  return invokeSafe<string | null>('get_file_thumbnail', { path, maxDim });
}
