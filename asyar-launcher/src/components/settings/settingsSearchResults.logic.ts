export type SearchResultsKeyAction = 'move-up' | 'move-down' | 'select' | 'none';

export function getSearchResultsKeyAction(
  event: Pick<KeyboardEvent, 'key'>,
): SearchResultsKeyAction {
  if (event.key === 'ArrowDown') return 'move-down';
  if (event.key === 'ArrowUp') return 'move-up';
  if (event.key === 'Enter') return 'select';
  return 'none';
}

/** Roving highlight over the results list. Wraps at both ends; moving down
 *  with nothing highlighted starts at the first result, moving up with
 *  nothing highlighted starts at the last — the usual combobox convention. */
export function moveHighlightedIndex(
  current: number,
  length: number,
  direction: 'move-up' | 'move-down',
): number {
  if (length === 0) return -1;
  if (direction === 'move-down') return current < length - 1 ? current + 1 : 0;
  return current > 0 ? current - 1 : length - 1;
}
