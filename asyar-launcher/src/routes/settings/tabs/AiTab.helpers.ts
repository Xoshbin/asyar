import type {
  IProviderPlugin,
  ModelInfo,
  ProviderConfig,
  ReasoningEffort,
} from '../../../services/ai/IProviderPlugin';
import type { CredentialState } from '../../../bindings';

/**
 * Returns all registered plugins available to be added as a new provider row.
 * Multiple connections of any provider (e.g. multiple custom endpoints or accounts)
 * are allowed.
 */
export function availableProvidersForNewRow(
  allPlugins: IProviderPlugin[],
  _existingProviderIds?: string[],
): IProviderPlugin[] {
  return allPlugins;
}

/**
 * Returns true if the current credential values satisfy the plugin's requirements,
 * meaning the user can proceed to fetch models.
 */
export function canTestAndFetch(
  plugin: IProviderPlugin | null | undefined,
  config: ProviderConfig | null | undefined,
  credentialState?: CredentialState,
): boolean {
  if (!plugin) return false;
  if (!config) return false;
  if (config.connectionMode === 'cli') return true;
  if (plugin.requiresApiKey && credentialState !== 'configured') return false;
  if (plugin.requiresBaseUrl && !config.baseUrl?.trim()) return false;
  return true;
}

export function configForNewProvider(
  plugin: IProviderPlugin | null | undefined,
  config: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    ...config,
    enabled: true,
    name: config.name || plugin?.name,
    providerType: plugin?.id,
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
  const isNewSelection = !config.lastModelId && effectiveModelId != null;

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

export type ProviderStatus =
  'ready' | 'checking' | 'cli_missing' | 'needs_key' | 'needs_url' | 'needs_model' | 'error';

/** A row's status from what is already known locally; never probes the network. */
export function providerStatus(
  plugin: IProviderPlugin | null | undefined,
  config: ProviderConfig,
  credentialState: CredentialState | undefined,
  cli: { checking: boolean; installed: boolean | undefined },
  fetchError: string,
): ProviderStatus {
  if (config.connectionMode === 'cli') {
    if (cli.checking || cli.installed === undefined) return 'checking';
    if (!cli.installed) return 'cli_missing';
  } else {
    if (plugin?.requiresApiKey && credentialState !== 'configured') return 'needs_key';
    if (plugin?.requiresBaseUrl && !config.baseUrl?.trim()) return 'needs_url';
  }
  if (fetchError) return 'fetch_failed';
  return config.lastModelId ? 'ready' : 'needs_model';
}
