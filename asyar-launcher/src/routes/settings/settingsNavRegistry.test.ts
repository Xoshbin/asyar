import { describe, it, expect } from 'vitest';
import {
  filterSearchIndex,
  buildSearchResults,
  SETTINGS_TABS,
  SETTINGS_SEARCH_INDEX,
  SECTION_ANCHORS,
  type SettingsSearchEntry,
  type SettingsTabDescriptor,
} from './settingsNavRegistry';

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

const TABS_FIXTURE: SettingsTabDescriptor[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'applications', label: 'Applications', icon: 'layers' },
  { id: 'backup', label: 'Backup', icon: 'cloud-upload' },
  { id: 'privacy', label: 'Privacy', icon: 'lock' },
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

describe('buildSearchResults', () => {
  it('returns nothing for an empty query', () => {
    expect(buildSearchResults(FIXTURE, TABS_FIXTURE, '')).toEqual([]);
  });

  it('does not add a tab fallback when the tab already has real matches', () => {
    const results = buildSearchResults(FIXTURE, TABS_FIXTURE, 'general');
    expect(results).toEqual([FIXTURE[0]]);
  });

  it('synthesizes a fallback entry for a tab with no indexed settings', () => {
    const results = buildSearchResults(FIXTURE, TABS_FIXTURE, 'backup');
    expect(results).toEqual([
      {
        id: 'tab-backup',
        title: 'Backup',
        description: 'Open the Backup tab.',
        tab: 'backup',
        tabLabel: 'Backup',
      },
    ]);
  });

  it('matches a tab fallback case-insensitively', () => {
    const results = buildSearchResults(FIXTURE, TABS_FIXTURE, 'PRIVACY');
    expect(results).toEqual([
      {
        id: 'tab-privacy',
        title: 'Privacy',
        description: 'Open the Privacy tab.',
        tab: 'privacy',
        tabLabel: 'Privacy',
      },
    ]);
  });

  it('returns an empty array when nothing matches either the index or a tab label', () => {
    expect(buildSearchResults(FIXTURE, TABS_FIXTURE, 'nonexistent-xyz')).toEqual([]);
  });
});

describe('registry consistency', () => {
  const tabIds = new Set(SETTINGS_TABS.map((tab) => tab.id));

  it('every search-index entry.tab is a real SETTINGS_TABS id', () => {
    for (const entry of SETTINGS_SEARCH_INDEX) {
      expect(tabIds.has(entry.tab), `"${entry.id}" points at unknown tab "${entry.tab}"`).toBe(
        true,
      );
    }
  });

  it('every search-index sectionAnchor resolves to a real SECTION_ANCHORS entry', () => {
    for (const entry of SETTINGS_SEARCH_INDEX) {
      if (!entry.sectionAnchor) continue;
      const anchorIds = new Set((SECTION_ANCHORS[entry.tab] ?? []).map((a) => a.id));
      expect(
        anchorIds.has(entry.sectionAnchor),
        `"${entry.id}" points at unknown sectionAnchor "${entry.sectionAnchor}" on tab "${entry.tab}"`,
      ).toBe(true);
    }
  });
});
