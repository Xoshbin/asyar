import { describe, it, expect } from 'vitest';
import { ActionTier, actionTier, compareActionTier } from './actionTier';

describe('actionTier', () => {
  it('treats an unmarked action as the item’s own', () => {
    expect(actionTier({})).toBe(ActionTier.Item);
  });

  it('places manage and launcher-wide actions below the item’s own', () => {
    expect(actionTier({ placement: 'manage' })).toBe(ActionTier.Manage);
    expect(actionTier({ placement: 'launcher' })).toBe(ActionTier.Launcher);
    expect(ActionTier.Item).toBeLessThan(ActionTier.Manage);
    expect(ActionTier.Manage).toBeLessThan(ActionTier.Launcher);
  });

  it('puts destructive last, whatever its placement', () => {
    expect(actionTier({ destructive: true })).toBe(ActionTier.Destructive);
    expect(actionTier({ destructive: true, placement: 'launcher' })).toBe(ActionTier.Destructive);
    expect(ActionTier.Launcher).toBeLessThan(ActionTier.Destructive);
  });
});

describe('compareActionTier', () => {
  it('orders by tier and keeps registration order within a tier', () => {
    const actions = [
      { id: 'danger', destructive: true },
      { id: 'settings', placement: 'launcher' as const },
      { id: 'own-1' },
      { id: 'assign', placement: 'manage' as const },
      { id: 'own-2' },
    ];

    expect([...actions].sort(compareActionTier).map((a) => a.id)).toEqual([
      'own-1',
      'own-2',
      'assign',
      'settings',
      'danger',
    ]);
  });
});
