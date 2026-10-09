import { toDisplayKeys } from '../../built-in-features/shortcuts/shortcutFormatter';
import type { HostPlatform } from './hostPlatform';
import type { ShortcutEntry } from './shortcutCatalog';

/**
 * Cheat-sheet rows generated from registered actions, so a shortcut declared
 * on an action is documented the moment it is declared and can never drift
 * from the binding. Launcher-reserved keys (⌘K, ⌘, …) are not actions and
 * stay in the static `LAUNCHER_SHORTCUTS`.
 */
export function actionShortcutEntries(
  actions: readonly { label: string; shortcut?: string }[],
  platform?: HostPlatform,
): ShortcutEntry[] {
  const seen = new Set<string>();
  const entries: ShortcutEntry[] = [];
  for (const a of actions) {
    if (!a.shortcut) continue;
    const key = `${a.shortcut}|${a.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ keys: toDisplayKeys(a.shortcut, platform), label: a.label, scope: 'view' });
  }
  return entries;
}
