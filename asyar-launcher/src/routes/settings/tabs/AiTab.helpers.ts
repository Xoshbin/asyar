import type {
  IProviderPlugin,
  ModelInfo,
  ProviderConfig,
  ReasoningEffort,
} from '../../../services/ai/IProviderPlugin';

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

export function configForNewProvider(
  plugin: IProviderPlugin | null | undefined,
  config: ProviderConfig,
): ProviderConfig {
  return {
    ...config,
    enabled: true,
    ...(plugin?.supportsOpenAIApiMode ? { openAIApiMode: 'responses' as const } : {}),
  };
}

export function reasoningEffortsForModel(
  plugin: IProviderPlugin | null | undefined,
  models: ModelInfo[],
  selectedModelId: string | undefined,
): readonly ReasoningEffort[] {
  const model = models.find((candidate) => candidate.id === selectedModelId);
  if (model?.reasoningEfforts !== undefined) return model.reasoningEfforts;
  return plugin?.reasoningEfforts ?? [];
}

export function reasoningEffortAfterModelChange(
  plugin: IProviderPlugin | null | undefined,
  models: ModelInfo[],
  modelId: string | undefined,
  currentEffort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!currentEffort) return undefined;
  return reasoningEffortsForModel(plugin, models, modelId).includes(currentEffort)
    ? currentEffort
    : undefined;
}
