export type CommandBarKeyAction = 'focus-search' | 'clear-search' | 'none';

/** Cmd+F / Ctrl+F focuses the search field from anywhere in the window.
 *  Escape clears the field, but only while it's focused and non-empty —
 *  deliberately does *not* close the window on an empty Escape (see the
 *  "Documented deviations" note in the plan this was built from). */
export function getCommandBarKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
  isSearchFocused: boolean,
  hasQuery: boolean,
): CommandBarKeyAction {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    return 'focus-search';
  }
  if (event.key === 'Escape' && isSearchFocused && hasQuery) {
    return 'clear-search';
  }
  return 'none';
}
