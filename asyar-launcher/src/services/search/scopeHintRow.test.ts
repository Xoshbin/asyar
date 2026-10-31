import { describe, it, expect, beforeEach } from 'vitest';
import { searchStores } from './stores/search.svelte';
import { buildScopeHintRow, insertScopeHint } from './scopeHintRow';
import { HINT_ICON } from './hintLook';
import type { SearchResult } from './interfaces/SearchResult';

const hint = { extensionId: 'org.asyar.coffee', extensionName: 'Coffee' };

function row(objectId: string, over: Partial<SearchResult> = {}): SearchResult {
  return {
    objectId,
    name: objectId,
    type: 'command',
    score: 0.5,
    tier: 4,
    ...over,
  } as SearchResult;
}

describe('buildScopeHintRow', () => {
  beforeEach(() => {
    searchStores.query = '';
  });

  it('describes the scope in plain words', () => {
    const r = buildScopeHintRow(hint, 4);
    expect(r.name).toBe('Search only in Coffee');
    expect(r.description).toBe('@Coffee');
    expect(r.objectId).toBe('scope_hint_org.asyar.coffee');
  });

  it('asks for the shared hint look, so every hint in the launcher reads the same', () => {
    expect(buildScopeHintRow(hint, 4).variant).toBe('hint');
  });

  it('wears the general hint icon, not a search glass, so later hints can share it', () => {
    expect(HINT_ICON).toBe('icon:info');
    expect(buildScopeHintRow(hint, 4).icon).toBe(HINT_ICON);
  });

  it('is not a command row, so Enter neither runs a command nor clears the query', () => {
    expect(buildScopeHintRow(hint, 4).type).toBe('scope');
  });

  it('turns the query into an @ search ready for a command word', () => {
    const r = buildScopeHintRow({ extensionId: 'x', extensionName: 'Color Picker' }, 4);
    (r.action as () => void)();
    expect(searchStores.query).toBe('@Color Picker ');
  });

  it('labels the Enter key', () => {
    expect(buildScopeHintRow(hint, 4).primaryActionLabel).toBe('Search');
  });

  it('takes the tier it is placed at, so tier order stays non-decreasing', () => {
    expect(buildScopeHintRow(hint, 4).tier).toBe(4);
  });
});

describe('insertScopeHint', () => {
  const coffee = (id: string) => row(id, { extensionId: 'org.asyar.coffee' });

  it('places the row right after the last command of that extension', () => {
    const results = [
      row('app', { type: 'application', tier: 3 }),
      coffee('c1'),
      coffee('c2'),
      row('file', { type: 'file', tier: 5 }),
    ];
    const out = insertScopeHint(results, hint);
    expect(out.map((r) => r.objectId)).toEqual([
      'app',
      'c1',
      'c2',
      'scope_hint_org.asyar.coffee',
      'file',
    ]);
  });

  it('inherits the tier of the command it follows', () => {
    const out = insertScopeHint([coffee('c1'), coffee('c2')], hint);
    expect(out[2].tier).toBe(4);
  });

  it('leaves the results alone when there is no hint', () => {
    const results = [coffee('c1'), coffee('c2')];
    expect(insertScopeHint(results, null)).toBe(results);
    expect(insertScopeHint(results, undefined)).toBe(results);
  });

  it('leaves the results alone when none of them belong to the extension', () => {
    const results = [row('other', { extensionId: 'org.other' })];
    expect(insertScopeHint(results, hint)).toBe(results);
  });

  it('does not change the list it was given', () => {
    const results = [coffee('c1'), coffee('c2')];
    insertScopeHint(results, hint);
    expect(results).toHaveLength(2);
  });
});
