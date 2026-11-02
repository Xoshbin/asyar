/** An Apple Shortcut in the user's library. */
export interface ShortcutInfo {
  /** Stable UUID; survives renames. May equal `name` on older macOS versions. */
  id: string;
  name: string;
}

/**
 * List and run Apple Shortcuts (macOS only).
 *
 * Requires `shortcuts:read` to list and `shortcuts:run` to run. Runs the
 * system `shortcuts` tool directly, so it needs no `shell:spawn` permission.
 */
export interface IShortcutsService {
  /** List the user's shortcuts. Requires `shortcuts:read`. */
  list(): Promise<ShortcutInfo[]>;

  /**
   * Run a shortcut by UUID or name and wait for it to finish. `input`, when
   * non-empty, is passed as the shortcut's Shortcut Input. Resolves with the
   * shortcut's text output (empty if it produces none) and rejects if it
   * exits with an error. Requires `shortcuts:run`.
   */
  run(idOrName: string, input?: string): Promise<string>;
}
