import { describe, it, expect } from 'vitest';
import { pickActiveSection, type SectionIntersection } from './settingsSectionNav.logic';

describe('pickActiveSection', () => {
  it('returns the fallback when nothing is intersecting', () => {
    const entries: SectionIntersection[] = [
      { id: 'a', top: 100, isIntersecting: false },
      { id: 'b', top: 400, isIntersecting: false },
    ];
    expect(pickActiveSection(entries, 'a')).toBe('a');
  });

  it('returns the topmost intersecting section', () => {
    const entries: SectionIntersection[] = [
      { id: 'a', top: -50, isIntersecting: true },
      { id: 'b', top: 10, isIntersecting: true },
      { id: 'c', top: 400, isIntersecting: false },
    ];
    expect(pickActiveSection(entries, null)).toBe('a');
  });

  it('ignores non-intersecting sections even if their top is smaller', () => {
    const entries: SectionIntersection[] = [
      { id: 'a', top: -500, isIntersecting: false },
      { id: 'b', top: 20, isIntersecting: true },
    ];
    expect(pickActiveSection(entries, null)).toBe('b');
  });

  it('returns null when there are no entries and no fallback', () => {
    expect(pickActiveSection([], null)).toBeNull();
  });
});
