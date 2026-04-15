/**
 * Effective (resolved) preferences for a single extension, as produced by
 * the launcher's preferences service. `extension` holds extension-level
 * values; `commands[commandId]` holds command-level values.
 */
export interface PreferenceValue {
  extension: Record<string, unknown>;
  commands: Record<string, Record<string, unknown>>;
}

/**
 * Request-response IPC surface for extension preferences. Complementary to
 * the boot-time `context.preferences` frozen snapshot: that snapshot is the
 * read path for declared default / user-saved values; this proxy is the
 * mutate path plus an on-demand re-read.
 */
export interface IPreferencesService {
  /** Read effective (resolved) preferences for the calling extension. */
  getAll(): Promise<PreferenceValue>;

  /**
   * Set a single preference value. `scope` is `'extension'` for extension-level
   * preferences, or a command id for command-level preferences.
   */
  set(scope: string, key: string, value: unknown): Promise<void>;

  /** Reset a scope to its manifest-declared defaults. */
  reset(scope: string): Promise<void>;
}
