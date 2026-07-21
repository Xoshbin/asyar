import { describe, it, expect } from 'vitest';
import { extractTags, findWikilinkAtCursor } from './noteLinks';

// Wikilink extraction and backlink resolution now live in Rust
// (storage::notes::extract_wikilinks / backlinks) and are tested there.
// This file covers only the live-editor helpers that stay on the frontend.

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
