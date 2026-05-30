/**
 * Human-readable catalog of launcher-global keyboard shortcuts.
 *
 * SOURCE OF TRUTH for the in-app Help cheat sheet and the user guide. The
 * *behavior* of these shortcuts lives in the handler functions in
 * `launcherKeyboard.ts`; this catalog is the *documentation* of them. When you
 * add or change a global binding there, update this list so the cheat sheet and
 * the guide stay in sync. The shortcutCatalog.test.ts guard checks the shape.
 *
 * The global show/hide hotkey is user-configurable (Settings → Shortcuts) and
 * is rendered separately by the Help view, so it is intentionally not listed
 * here. ⌘Q is intentionally omitted — Asyar blocks it; users quit via the
 * "Quit Asyar" command.
 */
export interface ShortcutEntry {
  /** Display tokens, rendered as individual keycaps, e.g. ['⌘', 'K']. */
  keys: string[];
  /** What the shortcut does, in plain language. */
  label: string;
  /** Where it applies. */
  scope: 'global' | 'view' | 'context';
}

export const LAUNCHER_SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: ['⌘', ','], label: 'Open Settings', scope: 'global' },
  { keys: ['⌘', 'K'], label: 'Toggle the action panel', scope: 'global' },
  { keys: ['⌘', 'P'], label: 'Toggle the search-bar dropdown (when one is shown)', scope: 'global' },
  { keys: ['Tab'], label: 'Fill command arguments, or switch to AI / context mode', scope: 'global' },
  { keys: ['↑', '↓'], label: 'Move between results', scope: 'global' },
  { keys: ['Enter'], label: 'Run the selected result', scope: 'global' },
  { keys: ['Esc'], label: 'Clear the search, go back, then hide Asyar', scope: 'global' },
  { keys: ['⌫'], label: 'Go back from a view, or exit AI mode when the search is empty', scope: 'view' },
] as const;
