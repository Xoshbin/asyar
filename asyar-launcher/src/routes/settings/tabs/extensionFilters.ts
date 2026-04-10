import type { ExtensionItem } from '../settingsHandlers.svelte';

export type ExtensionFilter = 'all' | 'commands' | 'view' | 'result' | 'theme';

export function filterExtensions(
  extensions: ExtensionItem[],
  query: string,
  filter: ExtensionFilter,
): ExtensionItem[] {
  let result = extensions;

  if (filter === 'view') result = result.filter(e => e.type === 'view');
  else if (filter === 'result') result = result.filter(e => e.type === 'result');
  else if (filter === 'theme') result = result.filter(e => e.type === 'theme');
  else if (filter === 'commands') result = result.filter(e => (e.commands?.length ?? 0) > 0);

  const q = query.trim().toLowerCase();
  if (!q) return result;

  return result.filter(ext => {
    if (ext.title.toLowerCase().includes(q)) return true;
    return ext.commands?.some(
      cmd => cmd.name.toLowerCase().includes(q) || cmd.trigger.toLowerCase().includes(q),
    ) ?? false;
  });
}
