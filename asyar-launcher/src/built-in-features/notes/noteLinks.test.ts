import { describe, it, expect } from 'vitest';
import { extractWikilinks, extractTags, getBacklinks, findWikilinkAtCursor } from './noteLinks';
import type { Note } from './noteStore.svelte';

function makeNote(id: string, title: string, body: string): Note {
  return { id, title, body, createdAt: 0, updatedAt: 0, pinned: false };
}

describe('extractWikilinks', () => {
  it('extracts a single [[Title]] reference', () => {
    expect(extractWikilinks('See [[Project Plan]] for details.')).toEqual(['Project Plan']);
  });

  it('extracts multiple references and trims whitespace', () => {
    expect(extractWikilinks('[[ Alpha ]] and [[Beta]]')).toEqual(['Alpha', 'Beta']);
  });

  it('returns an empty array when there are no references', () => {
    expect(extractWikilinks('just plain text')).toEqual([]);
  });

  it('does not match a single bracket or an unclosed reference', () => {
    expect(extractWikilinks('[not a link] and [[unclosed')).toEqual([]);
  });

  it('does not span across newlines', () => {
    expect(extractWikilinks('[[Alpha\nBeta]]')).toEqual([]);
  });
});

describe('extractTags', () => {
  it('extracts a simple #tag', () => {
    expect(extractTags('todo #work later')).toEqual(['work']);
  });

  it('extracts multiple tags including hyphens and underscores', () => {
    expect(extractTags('#follow-up and #high_priority')).toEqual(['follow-up', 'high_priority']);
  });

  it('does not treat a Markdown heading as a tag', () => {
    expect(extractTags('# Heading\nsome text')).toEqual([]);
  });

  it('does not treat a numeric-only hash (e.g. an issue reference) as a tag', () => {
    expect(extractTags('see issue #123')).toEqual([]);
  });

  it('de-duplicates repeated tags', () => {
    expect(extractTags('#work stuff #work more')).toEqual(['work']);
  });

  it('returns an empty array when there are no tags', () => {
    expect(extractTags('plain text')).toEqual([]);
  });
});

describe('getBacklinks', () => {
  const target = makeNote('1', 'Project Plan', 'the plan');
  const referencer = makeNote('2', 'Meeting Notes', 'discussed [[Project Plan]] today');
  const unrelated = makeNote('3', 'Grocery List', 'milk, eggs');
  const caseInsensitiveReferencer = makeNote('4', 'Follow-up', 'see [[project plan]]');

  it('finds notes that reference the target by title', () => {
    const backlinks = getBacklinks(target, [target, referencer, unrelated]);
    expect(backlinks.map((n) => n.id)).toEqual(['2']);
  });

  it('matches case-insensitively', () => {
    const backlinks = getBacklinks(target, [target, caseInsensitiveReferencer]);
    expect(backlinks.map((n) => n.id)).toEqual(['4']);
  });

  it('excludes the target note itself even if it self-references', () => {
    const selfReferencing = makeNote('1', 'Project Plan', 'see [[Project Plan]] above');
    const backlinks = getBacklinks(selfReferencing, [selfReferencing]);
    expect(backlinks).toEqual([]);
  });

  it('returns an empty array for a note with an empty title (cannot be linked to)', () => {
    const untitled = makeNote('5', '', 'body');
    const linksToEmpty = makeNote('6', 'X', '[[]]');
    expect(getBacklinks(untitled, [untitled, linksToEmpty])).toEqual([]);
  });

  it('returns an empty array when nothing references the target', () => {
    expect(getBacklinks(target, [target, unrelated])).toEqual([]);
  });
});

describe('findWikilinkAtCursor', () => {
  const body = 'See [[Project Plan]] for details.';

  it('returns the title when the cursor is inside the brackets', () => {
    const cursor = body.indexOf('Project'); // inside "Project Plan"
    expect(findWikilinkAtCursor(body, cursor)).toBe('Project Plan');
  });

  it('returns the title when the cursor is right after the closing ]]', () => {
    const cursor = body.indexOf(']]') + 2;
    expect(findWikilinkAtCursor(body, cursor)).toBe('Project Plan');
  });

  it('returns null when the cursor is outside any reference', () => {
    expect(findWikilinkAtCursor(body, 0)).toBe(null);
  });

  it('returns null when there is no reference in the body', () => {
    expect(findWikilinkAtCursor('plain text', 3)).toBe(null);
  });
});
