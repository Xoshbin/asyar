import { describe, it, expect } from 'vitest';
import { filterSearchIndex, type SettingsSearchEntry } from './settingsNavRegistry';

const FIXTURE: SettingsSearchEntry[] = [
  {
    id: 'a',
    title: 'Launch Asyar at login',
    description: 'Asyar starts in the background when you sign in.',
    tab: 'general',
    tabLabel: 'General',
    keywords: ['startup', 'autostart'],
  },
  {
    id: 'b',
    title: 'Search scope',
    description: 'Directories scanned for applications.',
    tab: 'applications',
    tabLabel: 'Applications',
    keywords: ['directory', 'folder'],
  },
];

describe('filterSearchIndex', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    expect(filterSearchIndex(FIXTURE, '')).toEqual([]);
    expect(filterSearchIndex(FIXTURE, '   ')).toEqual([]);
  });

  it('matches on title, case-insensitively', () => {
    expect(filterSearchIndex(FIXTURE, 'LOGIN')).toEqual([FIXTURE[0]]);
  });

  it('matches on description', () => {
    expect(filterSearchIndex(FIXTURE, 'background')).toEqual([FIXTURE[0]]);
  });

  it('matches on tab label', () => {
    expect(filterSearchIndex(FIXTURE, 'applications')).toEqual([FIXTURE[1]]);
  });

  it('matches on keywords', () => {
    expect(filterSearchIndex(FIXTURE, 'autostart')).toEqual([FIXTURE[0]]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterSearchIndex(FIXTURE, 'nonexistent-xyz')).toEqual([]);
  });
});
