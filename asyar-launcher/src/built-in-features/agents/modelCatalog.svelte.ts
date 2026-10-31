import { aiListModels } from '../../lib/ipc/commands';
import type { CredentialState } from '../../bindings';
import type { ModelInfo, ProviderConfig } from '../../services/ai/IProviderPlugin';
import { providerLabel } from './agentChatView.helpers';

/** A provider/model pair, as stored on a thread or an agent. */
export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** One row of the Change Provider / Change Model lists. */
export interface PickerOption {
  id: string;
  label: string;
}

type ProviderPlugins = Array<{ id: string; name: string; requiresApiKey?: boolean }>;

/**
 * The providers the user has set up and can run, in the order they were
 * configured. An API-mode provider that needs a key is listed only once its
 * key is `configured`; CLI-mode providers and key-less ones (Ollama) always
 * are. `credentialStates` (by instance id) is `null` until known, which lists
 * every enabled provider rather than flashing an empty picker. The provider
 * in use (`currentProviderId`) stays listed so the checkmark has a row.
 */
export function providerOptions(
  providers: Record<string, ProviderConfig>,
  plugins: ProviderPlugins,
  credentialStates: Record<string, CredentialState> | null = null,
  currentProviderId: string | null = null,
): PickerOption[] {
  const canRun = (id: string, config: ProviderConfig): boolean => {
    if (!credentialStates || config.connectionMode === 'cli') return true;
    const plugin = plugins.find((p) => p.id === (config.providerType ?? id));
    return !plugin?.requiresApiKey || credentialStates[id] === 'configured';
  };
  return Object.entries(providers)
    .filter(([id, config]) => config.enabled && (id === currentProviderId || canRun(id, config)))
    .map(([id]) => ({ id, label: providerLabel(id, providers, plugins) }));
}

/** One provider's models, keeping the one in use listed even if the provider's list lacks it. */
export function modelOptions(models: ModelInfo[], currentModelId: string | null): PickerOption[] {
  const options = models.map((model) => ({ id: model.id, label: model.label }));
  if (currentModelId && !options.some((o) => o.id === currentModelId)) {
    options.unshift({ id: currentModelId, label: currentModelId });
  }
  return options;
}

/** Every word of the query must appear in the label or id ("son 4"). */
export function filterOptions(options: PickerOption[], query: string): PickerOption[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const haystack = `${option.label} ${option.id}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The model to use when a thread switches to `providerId`: the provider's
 * last-used model, else the agent's own model if the agent is on that
 * provider. `null` means none is known yet, so the user picks one.
 */
export function modelForProvider(
  providerId: string,
  providers: Record<string, ProviderConfig>,
  agent: ModelRef,
): string | null {
  return (
    providers[providerId]?.lastModelId ??
    (agent.providerId === providerId ? agent.modelId : null) ??
    null
  );
}

/**
 * Session cache of each provider's model list. Lists come from the provider's
 * own API (the same call Settings and the agent editor make), so each is
 * fetched once per session, the first time its models are shown.
 */
export class ModelCatalog {
  models = $state<Record<string, ModelInfo[]>>({});
  loading = $state<Record<string, boolean>>({});
  errors = $state<Record<string, string>>({});

  // Resolved on use, not at construction: this singleton is created at import
  // time, and reading the IPC export then would tie every importer to it.
  constructor(private listModels?: typeof aiListModels) {}

  /** Fetch one provider's models unless cached or in flight. A failure is recorded, not thrown. */
  async load(providerId: string, config: ProviderConfig | undefined): Promise<void> {
    if (!config || this.models[providerId] || this.loading[providerId]) return;
    this.loading = { ...this.loading, [providerId]: true };
    const { [providerId]: _previous, ...otherErrors } = this.errors;
    this.errors = otherErrors;
    try {
      // By instance id: the backend looks the key up as `provider:<id>` and reads the
      // engine from `config.providerType`.
      const list = this.listModels ?? aiListModels;
      const models = await list(providerId, config);
      this.models = { ...this.models, [providerId]: models };
    } catch (err) {
      this.errors = {
        ...this.errors,
        [providerId]: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.loading = { ...this.loading, [providerId]: false };
    }
  }
}

export const modelCatalog = new ModelCatalog();
