import type { IProviderPlugin, ProviderConfig } from '../../../services/ai/IProviderPlugin';

/**
 * Returns all registered plugins NOT in the given set of existing provider IDs.
 * Used to populate the "Choose provider…" dropdown for a new row, preventing duplicates.
 */
export function availableProvidersForNewRow(
  allPlugins: IProviderPlugin[],
  existingProviderIds: string[],
): IProviderPlugin[] {
  const existing = new Set(existingProviderIds);
  return allPlugins.filter((p) => !existing.has(p.id));
}

/**
 * Returns true if the current credential values satisfy the plugin's requirements,
 * meaning the user can proceed to fetch models.
 */
export function canTestAndFetch(
  plugin: IProviderPlugin | null | undefined,
  config: ProviderConfig | null | undefined,
): boolean {
  if (!plugin) return false;
  if (!config) return false;
  if (plugin.requiresApiKey && !config.apiKey?.trim()) return false;
  if (plugin.requiresBaseUrl && !config.baseUrl?.trim()) return false;
  return true;
}
