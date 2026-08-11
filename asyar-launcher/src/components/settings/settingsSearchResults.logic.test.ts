import { describe, it, expect } from 'vitest';
import { getSearchResultsKeyAction, moveHighlightedIndex } from './settingsSearchResults.logic';

describe('getSearchResultsKeyAction', () => {
  it('maps ArrowDown to move-down', () => {
    expect(getSearchResultsKeyAction({ key: 'ArrowDown' })).toBe('move-down');
  });

  it('maps ArrowUp to move-up', () => {
    expect(getSearchResultsKeyAction({ key: 'ArrowUp' })).toBe('move-up');
  });

  it('maps Enter to select', () => {
    expect(getSearchResultsKeyAction({ key: 'Enter' })).toBe('select');
  });

  it('maps an unrelated key to none', () => {
    expect(getSearchResultsKeyAction({ key: 'a' })).toBe('none');
  });
});

describe('moveHighlightedIndex', () => {
  it('returns -1 when there are no results', () => {
    expect(moveHighlightedIndex(-1, 0, 'move-down')).toBe(-1);
    expect(moveHighlightedIndex(-1, 0, 'move-up')).toBe(-1);
  });

  it('moving down from no selection starts at the first result', () => {
    expect(moveHighlightedIndex(-1, 3, 'move-down')).toBe(0);
  });

  it('moving up from no selection wraps to the last result', () => {
    expect(moveHighlightedIndex(-1, 3, 'move-up')).toBe(2);
  });

  it('moving down advances by one', () => {
    expect(moveHighlightedIndex(0, 3, 'move-down')).toBe(1);
  });

  it('moving down from the last result wraps to the first', () => {
    expect(moveHighlightedIndex(2, 3, 'move-down')).toBe(0);
  });

  it('moving up retreats by one', () => {
    expect(moveHighlightedIndex(2, 3, 'move-up')).toBe(1);
  });

  it('moving up from the first result wraps to the last', () => {
    expect(moveHighlightedIndex(0, 3, 'move-up')).toBe(2);
  });
});
