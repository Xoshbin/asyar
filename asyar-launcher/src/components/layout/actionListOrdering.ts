import { ActionTier, actionTier, type TieredAction } from '../../services/action/actionTier';

const SINGLE_GROUP_TIERS: ReadonlySet<number> = new Set([
  ActionTier.Manage,
  ActionTier.Destructive,
]);

/**
 * Groups actions for the ⌘K panel. Groups are ordered by tier first, then by
 * where their category first appears, so a category shared between a row's own
 * actions and a launcher-wide one can never drag the latter up the list.
 * The manage and destructive tiers each form a single group whatever their
 * categories, like the one "Configure" and one trailing red section elsewhere.
 */
export function groupActionsForDisplay<T extends TieredAction & { displayCategory: string }>(
  actions: T[],
): Array<{ category: string; actions: T[] }> {
  const groups: Array<{ tier: number; key: string; category: string; actions: T[] }> = [];
  const byKey = new Map<string, (typeof groups)[number]>();

  for (const action of actions) {
    const tier = actionTier(action);
    const key = SINGLE_GROUP_TIERS.has(tier) ? `${tier}` : `${tier}\u0000${action.displayCategory}`;
    let group = byKey.get(key);
    if (!group) {
      group = { tier, key, category: action.displayCategory, actions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.actions.push(action);
  }

  // Array.prototype.sort is stable, so groups of one tier keep first-seen order.
  return groups
    .sort((a, b) => a.tier - b.tier)
    .map(({ category, actions: acts }) => ({ category, actions: acts }));
}
