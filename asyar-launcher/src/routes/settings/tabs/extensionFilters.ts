import type { ExtensionItem } from '../settingsHandlers.svelte';

/**
 * Settings-page filter categories. After the Tier 2 worker/view split the
 * legacy `'view'` and `'result'` extension types collapsed into a single
 * `'extension'` type; the view/background distinction now lives on
 * individual commands. `'extension'` keeps only type=extension rows,
 * `'theme'` keeps only type=theme rows.
 */
export type ExtensionFilter = 'all' | 'commands' | 'extension' | 'theme';

export function filterExtensions(
  extensions: ExtensionItem[],
  query: string,
  filter: ExtensionFilter,
): ExtensionItem[] {
  let result = extensions;

  if (filter === 'extension') result = result.filter(e => e.type === 'extension' || !e.type);
  else if (filter === 'theme') result = result.filter(e => e.type === 'theme');
  else if (filter === 'commands') result = result.filter(e => (e.commands?.length ?? 0) > 0);

  const q = query.trim().toLowerCase();
  if (!q) return result;

  return result.filter(ext => {
    if (ext.title.toLowerCase().includes(q)) return true;
    return ext.commands?.some(
      cmd => cmd.name.toLowerCase().includes(q) || (cmd.trigger ?? '').toLowerCase().includes(q),
    ) ?? false;
  });
}
