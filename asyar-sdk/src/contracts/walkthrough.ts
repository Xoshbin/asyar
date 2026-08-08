/**
 * Walkthrough contributions — the tasks an extension declares to teach its
 * own features.
 *
 * Extensions declare tasks and nothing else: completion is decided by the
 * launcher from real usage, so no extension code ever runs to mark a task
 * done. Mirrors `WalkthroughTaskDecl` / `CompletionRule` in
 * `src-tauri/src/walkthrough/mod.rs`.
 */

/** How a task decides it is done. */
export type CompletionRule =
  /** Done the first time a launch matches `target` (glob, e.g. `cmd_org.asyar.notes_*`). */
  | { type: 'launch'; target: string }
  /**
   * Done after `times` matching launches and/or launches on `distinctDays`
   * separate days. Both default to 1, so `count` with neither is `launch`.
   * Use `distinctDays` to teach a habit rather than a single visit.
   */
  | { type: 'count'; target: string; times?: number; distinctDays?: number }
  /** Done when a launcher-reported counter reaches `atLeast` (default 1). */
  | { type: 'state'; probe: string; atLeast?: number }
  /** No automatic detection — the user ticks it themselves. */
  | { type: 'manual' };

export interface WalkthroughTaskDecl {
  /** Local to the manifest; qualified to `wt_<extensionId>_<id>` by the launcher. */
  id: string;
  title: string;
  /** One line, shown in the task list. */
  summary?: string;
  /** Markdown detail body, shown when the task is opened. */
  body?: string;
  icon?: string;
  /** Static asset path for the detail preview — local, never a remote URL. */
  image?: string;
  /** Ascending sort key within the combined list. Ties break on id. */
  order?: number;
  completion: CompletionRule;
}
