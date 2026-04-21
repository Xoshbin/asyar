import { filterExtensions } from './extensionFilters';
import type { ExtensionItem } from '../settingsHandlers.svelte';

function makeExt(
  title: string,
  type: string,
  commands: { id: string; name: string; trigger: string }[] = [],
): ExtensionItem {
  return {
    title,
    type,
    commands: commands.map(c => ({ ...c, description: '' })),
  };
}

// After the Tier 2 worker/view split there are only two extension types:
// "extension" (everything with commands) and "theme". The per-command
// view/background distinction is filtered elsewhere.
const extensions: ExtensionItem[] = [
  makeExt('Catppuccin', 'theme'),
  makeExt('Pomodoro Timer', 'extension', [
    { id: 'c1', name: 'Start Timer', trigger: 'pomo start' },
    { id: 'c2', name: 'Stop Timer', trigger: 'pomo stop' },
  ]),
  makeExt('GitHub', 'extension', [
    { id: 'c3', name: 'Search Repos', trigger: 'gh repos' },
  ]),
];

describe('filterExtensions', () => {
  describe('filter = all, query = empty', () => {
    it('returns all extensions', () => {
      expect(filterExtensions(extensions, '', 'all')).toHaveLength(3);
    });

    it('returns all when query is only whitespace', () => {
      expect(filterExtensions(extensions, '   ', 'all')).toHaveLength(3);
    });
  });

  describe('query matching', () => {
    it('matches by extension title (case-insensitive)', () => {
      const result = filterExtensions(extensions, 'github', 'all');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('GitHub');
    });

    it('matches by command name', () => {
      const result = filterExtensions(extensions, 'search repos', 'all');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('GitHub');
    });

    it('matches by command trigger', () => {
      const result = filterExtensions(extensions, 'pomo', 'all');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Pomodoro Timer');
    });

    it('returns empty array when nothing matches', () => {
      expect(filterExtensions(extensions, 'zzz', 'all')).toHaveLength(0);
    });

    it('trims the query before matching', () => {
      expect(filterExtensions(extensions, '  github  ', 'all')).toHaveLength(1);
    });
  });

  describe('type filters', () => {
    it('filter extension returns only type=extension rows', () => {
      const result = filterExtensions(extensions, '', 'extension');
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.title).sort()).toEqual(['GitHub', 'Pomodoro Timer']);
    });

    it('filter theme returns only theme extensions', () => {
      const result = filterExtensions(extensions, '', 'theme');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Catppuccin');
    });

    it('filter commands returns only extensions that have commands', () => {
      const result = filterExtensions(extensions, '', 'commands');
      expect(result).toHaveLength(2);
    });
  });

  describe('combined filter + query', () => {
    it('applies both type filter and query', () => {
      expect(filterExtensions(extensions, 'github', 'extension')).toHaveLength(1);
      expect(filterExtensions(extensions, 'zzz', 'extension')).toHaveLength(0);
    });
  });
});
