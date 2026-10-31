import type { ScopeHint } from '../../bindings';
import { t } from '../i18n';
import { searchStores } from './stores/search.svelte';
import { HINT_ICON, HINT_VARIANT } from './hintLook';
import type { SearchResult } from './interfaces/SearchResult';

const ROW_ID_PREFIX = 'scope_hint_';

/**
 * The "Search only in Coffee" row. Enter rewrites the query to `@Coffee ` so
 * the search narrows to that extension's commands, cursor ready for a command
 * word.
 *
 * Deliberately not `type: 'command'`: command rows hide the launcher or clear
 * the query after their action, and this row must leave `@Coffee ` in place.
 */
export function buildScopeHintRow(hint: ScopeHint, tier: number): SearchResult {
  return {
    objectId: `${ROW_ID_PREFIX}${hint.extensionId}`,
    name: t('search.scope_hint_title', { name: hint.extensionName }),
    description: `@${hint.extensionName}`,
    type: 'scope',
    // The shared hint look — every hint in the launcher is drawn this way.
    variant: HINT_VARIANT,
    icon: HINT_ICON,
    score: 0,
    // Takes the tier of the row it follows so tier order stays non-decreasing.
    tier,
    primaryActionLabel: t('search.scope_hint_action'),
    action: () => {
      searchStores.query = `@${hint.extensionName} `;
    },
  };
}

/**
 * Places the scope row right after the last command of the named extension, so
 * it reads as part of that group and is on screen whenever the group is. The
 * end of the list is usually below the fold. Returns `results` untouched when
 * there is no hint or none of the results belong to the extension.
 */
export function insertScopeHint(
  results: SearchResult[],
  hint: ScopeHint | null | undefined,
): SearchResult[] {
  if (!hint) return results;
  let last = -1;
  results.forEach((r, i) => {
    if (r.type === 'command' && r.extensionId === hint.extensionId) last = i;
  });
  if (last < 0) return results;
  return [
    ...results.slice(0, last + 1),
    buildScopeHintRow(hint, results[last].tier),
    ...results.slice(last + 1),
  ];
}
