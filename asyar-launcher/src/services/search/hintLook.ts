/**
 * What every hint in the launcher shares. A hint is an offer to the user, not a
 * result, and it is drawn one way: `variant: HINT_VARIANT` on the row (the look
 * itself lives in LauncherListRow) with `icon: HINT_ICON`. The icon is a
 * general "i", not tied to any one feature, so a hint for something new does
 * not need to pick its own.
 */
export const HINT_VARIANT = 'hint' as const;
export const HINT_ICON = 'icon:info';
