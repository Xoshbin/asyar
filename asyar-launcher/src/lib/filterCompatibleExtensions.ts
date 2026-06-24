import { invoke } from '@tauri-apps/api/core';

export interface PlatformCheckFields<T> {
  id: (item: T) => string;
  platforms: (item: T) => string[] | undefined;
}

/**
 * Filter a list down to items compatible with the current OS, via the
 * `filter_compatible_extensions` command (backed by
 * `extensions::discovery::is_platform_compatible`) — the same platform check
 * used to validate locally-installed extensions. There is no JS copy of this
 * predicate.
 */
export async function filterCompatibleExtensions<T>(
  items: T[],
  fields: PlatformCheckFields<T>,
): Promise<T[]> {
  if (items.length === 0) return [];

  const payload = items.map((item) => ({
    id: fields.id(item),
    platforms: fields.platforms(item) ?? null,
  }));

  const compatibleIds = await invoke<string[]>('filter_compatible_extensions', { items: payload });

  const byId = new Map(items.map((item) => [fields.id(item), item]));
  return compatibleIds
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);
}
