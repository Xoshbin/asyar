import { describe, it, expect, vi, beforeEach } from 'vitest';

// No external deps to mock for a pure function, but follow the skill pattern
beforeEach(() => vi.clearAllMocks());

// Import AFTER any mocks (none needed here, but keeping canonical ordering)
import { groupActionsForDisplay } from './actionListOrdering';

interface MinimalAction {
  id: string;
  displayCategory: string;
  destructive?: boolean;
  placement?: 'manage' | 'launcher';
}

describe('groupActionsForDisplay', () => {
  it('returns groups in the order their categories first appear', () => {
    const actions: MinimalAction[] = [
      { id: 'a1', displayCategory: 'Clipboard' },
      { id: 'b1', displayCategory: 'System' },
      { id: 'a2', displayCategory: 'Clipboard' },
    ];

    const groups = groupActionsForDisplay(actions);

    expect(groups.map((g) => g.category)).toEqual(['Clipboard', 'System']);
  });

  it('within each group, items appear in declared order (no sort)', () => {
    const actions: MinimalAction[] = [
      { id: 'z', displayCategory: 'Actions' },
      { id: 'a', displayCategory: 'Actions' },
      { id: 'm', displayCategory: 'Actions' },
    ];

    const groups = groupActionsForDisplay(actions);

    expect(groups).toHaveLength(1);
    expect(groups[0].actions.map((a) => a.id)).toEqual(['z', 'a', 'm']);
  });

  it('returns an empty array for empty input', () => {
    const groups = groupActionsForDisplay([]);
    expect(groups).toEqual([]);
  });

  it('handles a single action correctly (one group, one item)', () => {
    const actions: MinimalAction[] = [{ id: 'solo', displayCategory: 'Misc' }];

    const groups = groupActionsForDisplay(actions);

    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('Misc');
    expect(groups[0].actions).toHaveLength(1);
    expect(groups[0].actions[0].id).toBe('solo');
  });

  it('critical regression: two actions in same group declared [A, B] remain [A, B] regardless of any external state', () => {
    // This pins "no hotness sorting" — the order must be declaration order only
    const actions: MinimalAction[] = [
      { id: 'A', displayCategory: 'Tools' },
      { id: 'B', displayCategory: 'Tools' },
    ];

    const groups = groupActionsForDisplay(actions);

    expect(groups).toHaveLength(1);
    expect(groups[0].actions.map((a) => a.id)).toEqual(['A', 'B']);
    // Call again to confirm determinism (no localStorage / usage state involved)
    const groups2 = groupActionsForDisplay(actions);
    expect(groups2[0].actions.map((a) => a.id)).toEqual(['A', 'B']);
  });

  describe('tiers', () => {
    it('keeps a destructive action out of its own category and merges it into one trailing group', () => {
      // A file row: its own actions share a category with Move to Trash, and
      // Uninstall brings a different one. Both red actions end up together.
      const actions: MinimalAction[] = [
        { id: 'reveal', displayCategory: 'File Search' },
        { id: 'trash', displayCategory: 'File Search', destructive: true },
        { id: 'copy', displayCategory: 'File Search' },
        { id: 'uninstall', displayCategory: 'Danger', destructive: true },
      ];

      const groups = groupActionsForDisplay(actions);

      expect(groups.map((g) => g.actions.map((a) => a.id))).toEqual([
        ['reveal', 'copy'],
        ['trash', 'uninstall'],
      ]);
    });

    it('merges the manage actions into one group whatever their categories', () => {
      const actions: MinimalAction[] = [
        { id: 'assign-shortcut', displayCategory: 'Shortcuts', placement: 'manage' },
        { id: 'assign-alias', displayCategory: 'Aliases', placement: 'manage' },
        { id: 'configure', displayCategory: 'Extension', placement: 'manage' },
      ];

      const groups = groupActionsForDisplay(actions);

      expect(groups.map((g) => g.actions.map((a) => a.id))).toEqual([
        ['assign-shortcut', 'assign-alias', 'configure'],
      ]);
    });

    it('lets tier beat first-seen category order', () => {
      // An extension action filed under "System" must not drag the launcher's
      // own System actions up with it.
      const actions: MinimalAction[] = [
        { id: 'settings', displayCategory: 'System', placement: 'launcher' },
        { id: 'ext-action', displayCategory: 'System' },
      ];

      const groups = groupActionsForDisplay(actions);

      expect(groups.map((g) => g.actions.map((a) => a.id))).toEqual([['ext-action'], ['settings']]);
    });

    it('orders item, manage, launcher-wide, then destructive', () => {
      const actions: MinimalAction[] = [
        { id: 'factory', displayCategory: 'Danger', destructive: true },
        { id: 'settings', displayCategory: 'System', placement: 'launcher' },
        { id: 'assign', displayCategory: 'Shortcuts', placement: 'manage' },
        { id: 'reveal', displayCategory: 'Item' },
      ];

      const groups = groupActionsForDisplay(actions);

      expect(groups.map((g) => g.actions[0].id)).toEqual([
        'reveal',
        'assign',
        'settings',
        'factory',
      ]);
    });

    it('keeps the favorite with the item’s own actions that share its category', () => {
      const actions: MinimalAction[] = [
        { id: 'reveal', displayCategory: 'Item' },
        { id: 'copy-path', displayCategory: 'Item' },
        { id: 'favorite', displayCategory: 'Item' },
      ];

      expect(groupActionsForDisplay(actions)).toHaveLength(1);
    });
  });
});
