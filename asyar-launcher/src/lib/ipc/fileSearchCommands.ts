import { invoke } from '@tauri-apps/api/core';
import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type { FileHit, FileIndexConfig, FileSearchResponse, IndexStatus } from '../../bindings';

export async function fileSearch(
  query: string,
  typeFilter?: string,
  limit?: number,
): Promise<FileSearchResponse | null> {
  return invokeSafe<FileSearchResponse>('file_search', {
    query,
    typeFilter: typeFilter ?? null,
    limit,
  });
}

export async function fileIndexStatus(): Promise<IndexStatus | null> {
  return invokeSafe<IndexStatus>('file_index_status');
}

export async function fileIndexRebuild(): Promise<boolean> {
  return invokeSafeVoid('file_index_rebuild');
}

export async function fileIndexSetConfig(config: FileIndexConfig): Promise<boolean> {
  return invokeSafeVoid('file_index_set_config', { config });
}

export async function fileSearchRecordSelection(query: string, fileId: string): Promise<boolean> {
  return invokeSafeVoid('file_search_record_selection', { query, fileId });
}

export async function fileSearchPin(fileId: string, path: string): Promise<boolean> {
  return invokeSafeVoid('file_search_pin', { fileId, path });
}

export async function fileSearchUnpin(fileId: string): Promise<boolean> {
  return invokeSafeVoid('file_search_unpin', { fileId });
}

export async function fileSearchListPinned(): Promise<FileHit[] | null> {
  return invokeSafe<FileHit[]>('file_search_list_pinned');
}

export async function fileSearchClearHistory(): Promise<boolean> {
  return invokeSafeVoid('file_search_clear_history');
}

export async function deepSearchAvailability(): Promise<string | null> {
  return invokeSafe<string | null>('deep_search_availability');
}

export async function deepSearch(query: string, limit?: number): Promise<FileHit[] | null> {
  return invokeSafe<FileHit[]>('deep_search', { query, limit });
}

export async function openInTerminal(pathStr: string): Promise<boolean> {
  return invokeSafeVoid('open_in_terminal', { pathStr });
}

export async function quickLookPath(pathStr: string): Promise<boolean> {
  return invokeSafeVoid('quick_look_path', { pathStr }, { silent: true });
}

/** Bounded text-content read for the preview pane — goes through Rust
 * (`std::fs`) rather than `@tauri-apps/plugin-fs`, so it isn't subject to
 * the webview's fs capability scope (which never covered arbitrary
 * `$HOME` paths, only `$APPDATA/extensions/**` and
 * `$APPDATA/clipboard_cache/**`). */
export async function readTextPreview(pathStr: string, maxBytes?: number): Promise<string | null> {
  return invokeSafe<string>('read_text_preview', { pathStr, maxBytes });
}

/** Extension-scoped bounded content read (`asyar:api:files:read` →
 * `files_read_text`). Raw `invoke` rather than `invokeSafe` deliberately:
 * a permission/scope denial must propagate to the calling extension as an
 * error, not collapse into a null that's indistinguishable from an empty
 * file. */
export async function filesReadText(
  extensionId: string | null,
  pathStr: string,
  maxBytes?: number,
): Promise<string> {
  return invoke<string>('files_read_text', { extensionId, pathStr, maxBytes });
}

/** Extension-scoped filename enumeration (`asyar:api:files:glob` →
 * `files_glob`). Raw `invoke` for the same reason as `filesReadText`: a
 * scope denial must surface as an error, not as an empty result — an empty
 * array here specifically means "the walk root exists (or doesn't) and
 * nothing in scope matched". */
export async function filesGlob(
  extensionId: string | null,
  pattern: string,
  maxResults?: number,
): Promise<string[]> {
  return invoke<string[]>('files_glob', { extensionId, pattern, maxResults });
}

/** Extension-scoped thumbnail generation (`asyar:api:files:thumbnail` →
 * `files_thumbnail`). Resolves to the `asyar-thumb://` URL, or `null` when
 * the file type has no thumbnail strategy on this platform; scope denials
 * reject. */
export async function filesThumbnail(
  extensionId: string | null,
  pathStr: string,
  maxDim?: number,
): Promise<string | null> {
  return invoke<string | null>('files_thumbnail', { extensionId, pathStr, maxDim });
}
