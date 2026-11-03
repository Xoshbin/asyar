import { describe, it, expect } from 'vitest';
import { resolveNavigation, SIDEBAR_GROUPS } from './settingsNav';

describe('resolveNavigation', () => {
  it.each([
    ['ai', 'agents'],
    ['file-search', 'file-search'],
    ['browsers', 'browsers'],
    ['scripts', 'scripts'],
  ])('routes legacy tab %s into the built-in drill-down', (tab, id) => {
    expect(resolveNavigation({ tab }, false)).toEqual({
      tab: 'built-in-features',
      extensionId: id,
    });
  });

  it('routes applications to its own sidebar tab', () => {
    expect(resolveNavigation({ tab: 'applications' }, false)).toEqual({
      tab: 'applications',
      extensionId: null,
    });
  });

  it.each(['file-search', 'scripts', 'clipboard-history', 'snippets', 'agents', 'browsers'])(
    'routes the real built-in manifest id %s to built-in-features',
    (id) => {
      expect(resolveNavigation({ tab: 'extensions', extensionId: id }, false)).toEqual({
        tab: 'built-in-features',
        extensionId: id,
      });
    },
  );

  it('routes built-in extension ids to built-in-features', () => {
    expect(resolveNavigation({ tab: 'extensions', extensionId: 'built-in-notes' }, false)).toEqual({
      tab: 'built-in-features',
      extensionId: 'built-in-notes',
    });
  });

  it('keeps store extension ids on the extensions tab', () => {
    expect(resolveNavigation({ tab: 'extensions', extensionId: 'org.x.store' }, false)).toEqual({
      tab: 'extensions',
      extensionId: 'org.x.store',
    });
  });

  it('extensions without an id has no drill-down', () => {
    expect(resolveNavigation({ tab: 'extensions' }, false)).toEqual({
      tab: 'extensions',
      extensionId: null,
    });
  });

  it.each(['general', 'privacy', 'backup', 'account', 'advanced', 'about'])(
    'passes %s through',
    (tab) => {
      expect(resolveNavigation({ tab }, false)).toEqual({ tab, extensionId: null });
    },
  );

  it('gates developer on Developer Mode', () => {
    expect(resolveNavigation({ tab: 'developer' }, true).tab).toBe('developer');
    expect(resolveNavigation({ tab: 'developer' }, false).tab).toBe('advanced');
  });

  it('falls back to general for unknown tabs', () => {
    expect(resolveNavigation({ tab: 'bogus' }, false).tab).toBe('general');
  });
});

describe('SIDEBAR_GROUPS', () => {
  it('lists the nine tabs in spec order', () => {
    expect(SIDEBAR_GROUPS.flatMap((g) => g.tabs)).toEqual([
      'account',
      'general',
      'applications',
      'built-in-features',
      'extensions',
      'privacy',
      'backup',
      'advanced',
      'developer',
      'about',
    ]);
  });
});
