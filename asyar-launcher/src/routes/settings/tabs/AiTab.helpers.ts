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

export interface FetchModelsOutcome {
  /** Config fields to persist after a fetch (may be empty). */
  configPatch: Partial<ProviderConfig>;
  /** The model id to auto-adopt as default, set only on a first-time selection. */
  newlySelectedModelId: string | undefined;
}

/**
 * Decides what to persist after models are fetched for a provider.
 *
 * The model <select> shows `config.lastModelId ?? models[0].id`, so an
 * untouched dropdown displays the first model but fires no onchange — the id
 * would never persist, leaving `lastModelId` unset and the ★ default button
 * disabled. This seeds the effective model so the button works and the first
 * provider can auto-default.
 */
export function modelSelectionAfterFetch(
  plugin: IProviderPlugin | null | undefined,
  models: ModelInfo[],
  config: ProviderConfig,
): FetchModelsOutcome {
  const effectiveModelId = config.lastModelId ?? models[0]?.id;
  const reasoningEffort = reasoningEffortAfterModelChange(
    plugin,
    models,
    effectiveModelId,
    config.reasoningEffort,
  );
  const isNewSelection = !config.lastModelId && effectiveModelId !== undefined;

  const configPatch: Partial<ProviderConfig> = {};
  if (isNewSelection) configPatch.lastModelId = effectiveModelId;
  if (reasoningEffort !== config.reasoningEffort) configPatch.reasoningEffort = reasoningEffort;

  return {
    configPatch,
    newlySelectedModelId: isNewSelection ? effectiveModelId : undefined,
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
