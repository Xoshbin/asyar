/**
 * Where an action sits in the ⌘K panel, top to bottom: the selected row's own
 * actions, then how that row is managed (shortcut, alias, extension settings),
 * then launcher-wide actions, then everything destructive in one trailing
 * group. This is the single definition both the action list and its category
 * grouping use, so the order the service produces is the order the user sees.
 */
export const ActionTier = {
  Item: 0,
  Manage: 1,
  Launcher: 2,
  Destructive: 3,
} as const;

export type ActionTierValue = (typeof ActionTier)[keyof typeof ActionTier];

/**
 * Declared on a built-in action where it is registered. Unmarked actions are
 * the item's own, which is also what a Tier 2 extension's actions get, so new
 * extension actions land on top without anyone remembering to list them.
 */
export type ActionPlacement = 'manage' | 'launcher';

export interface TieredAction {
  destructive?: boolean;
  placement?: ActionPlacement;
}

export function actionTier(action: TieredAction): ActionTierValue {
  if (action.destructive) return ActionTier.Destructive;
  if (action.placement === 'launcher') return ActionTier.Launcher;
  if (action.placement === 'manage') return ActionTier.Manage;
  return ActionTier.Item;
}

export function compareActionTier(a: TieredAction, b: TieredAction): number {
  return actionTier(a) - actionTier(b);
}
