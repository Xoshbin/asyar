import { invokeSafe, invokeSafeVoid } from './invokeSafe';

/**
 * Moves the clipboard plugin's freshly written PNG into this history item's
 * own slot under `$APPDATA/clipboard_cache/` and resolves to the new path.
 *
 * `null` when the move failed — the caller keeps the plugin's original path,
 * which stays readable, so the preview still works.
 *
 * Rust-side because the webview's fs capability grants no write, copy,
 * rename, or remove anywhere; widening it for one internal file move would
 * hand the webview a general write primitive in the app data directory.
 */
export async function clipboardAdoptImage(id: string, sourcePath: string): Promise<string | null> {
  return invokeSafe<string>('clipboard_adopt_image', { id, sourcePath });
}

/**
 * Deletes a cached image when its history row goes away. Rust ignores paths
 * outside `clipboard_cache/` — legacy rows still point into the plugin's
 * content-addressed directory, where duplicate copies share one file.
 */
export async function clipboardForgetImage(path: string): Promise<boolean> {
  return invokeSafeVoid('clipboard_forget_image', { path }, { silent: true });
}
