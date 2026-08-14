<script lang="ts">
  import {
    SettingsForm,
    SettingsFormRow,
    Toggle,
    Button,
    Input,
    InlineError,
    EmptyState,
    SettingsCard,
    SettingsPaneHeader,
  } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { providerRegistry } from '../../../services/ai/providerRegistry';
  import { agentService } from '../../../built-in-features/agents/agentService.svelte';
  import { agentsProviderRemovalBlockers } from '../../../lib/ipc/commands';
  import {
    availableProvidersForNewRow,
    canTestAndFetch,
    configForNewProvider,
    modelSelectionAfterFetch,
    reasoningEffortAfterModelChange,
    reasoningEffortsForModel,
  } from './AiTab.helpers';
  import type {
    IProviderPlugin,
    ModelInfo,
    OpenAIApiMode,
    ProviderConfig,
    ReasoningEffort,
  } from '../../../services/ai/IProviderPlugin';
  import type { ProviderId } from '../../../services/settings/types/AppSettingsType';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let { handler, mode = 'full' }: { handler?: SettingsHandler; mode?: 'full' | 'providers-only' } =
    $props();

  let settings = $derived(settingsService.currentSettings.ai);

  // Session-cached model lists — not persisted, re-fetched on next launch
  let modelCache = $state<Record<string, ModelInfo[]>>({});
  let fetchingModels = $state<Record<string, boolean>>({});
  let fetchErrors = $state<Record<string, string>>({});
  // Track custom-model-id input mode per provider
  let customModelMode = $state<Record<string, boolean>>({});
  // Why a provider removal was refused, keyed by provider id. Shown inline
  // in the row — the Settings window is a separate webview from the
  // launcher, so feedbackService's bottom bar never renders here.
  let removeErrors = $state<Record<string, string>>({});
  // Why setting/updating a provider's default agent failed, keyed by the
  // provider id that was being made (or already is) the default. Same
  // inline-in-the-row reasoning as removeErrors.
  let defaultAgentErrors = $state<Record<string, string>>({});

  // Draft row: a new row the user started via "+ Add" but hasn't committed yet
  let draftActive = $state(false);
  let draftPickedId = $state<ProviderId | null>(null);

  // Per-row expand/collapse state. Already-configured rows start collapsed;
  // newly-added rows auto-expand so the user can fill in credentials.
  let expandedRows = $state<Record<string, boolean>>({});

  function isExpanded(id: string): boolean {
    return expandedRows[id] === true;
  }

  function toggleExpanded(id: string) {
    expandedRows = { ...expandedRows, [id]: !expandedRows[id] };
  }

  // Ensure agents are loaded
  $effect(() => {
    agentService.init().catch(() => {
      // init already reports its own diagnostic
    });
  });

  let allPlugins = $derived(providerRegistry.list());

  /** Provider IDs that have enabled: true in settings */
  let configuredIds = $derived(
    Object.keys(settings.providers).filter((id) => settings.providers[id]?.enabled === true),
  );

  function getPlugin(id: string): IProviderPlugin | undefined {
    const config = settings.providers[id];
    const providerType = (config?.providerType ?? id) as ProviderId;
    return allPlugins.find((p) => p.id === providerType);
  }

  function getConfig(id: string): ProviderConfig {
    return settings.providers[id] ?? { enabled: false };
  }

  function updateProviderConfig(id: string, partial: Partial<ProviderConfig>) {
    return settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [id]: { ...getConfig(id), ...partial },
      },
    });
  }

  function reasoningEffortLabel(effort: ReasoningEffort): string {
    if (effort === 'none') return 'Off';
    if (effort === 'minimal') return 'Minimal';
    if (effort === 'xhigh') return 'X-high';
    if (effort === 'max') return 'Maximum';
    return `${effort[0].toUpperCase()}${effort.slice(1)}`;
  }

  async function fetchModels(providerId: string, plugin: IProviderPlugin) {
    fetchingModels = { ...fetchingModels, [providerId]: true };
    fetchErrors = { ...fetchErrors, [providerId]: '' };
    try {
      const config = getConfig(providerId);
      const models = await plugin.getModels(config);
      modelCache = { ...modelCache, [providerId]: models };
      fetchErrors = { ...fetchErrors, [providerId]: '' };
      // Seed the effective model so the ★ default button is enabled even when
      // the user keeps the pre-selected first entry (which fires no onchange).
      const { configPatch, newlySelectedModelId } = modelSelectionAfterFetch(
        plugin,
        models,
        config,
      );
      if (Object.keys(configPatch).length > 0) {
        await updateProviderConfig(providerId, configPatch);
      }
      if (newlySelectedModelId) {
        await maybeAutoSetAsDefault(providerId, newlySelectedModelId);
      }
    } catch (e: unknown) {
      fetchErrors = {
        ...fetchErrors,
        [providerId]: e instanceof Error ? e.message : 'Failed to fetch models',
      };
      modelCache = { ...modelCache, [providerId]: [] };
    } finally {
      fetchingModels = { ...fetchingModels, [providerId]: false };
    }
  }

  function isDefault(id: string): boolean {
    const agent = agentService.getDefaultAgent();
    return agent?.providerId === id;
  }

  // Make a provider the sole default. `fallbackModelId` is the first fetched
  // model, used when the user hasn't explicitly picked one yet (an untouched
  // dropdown fires no onchange). The resolved model is persisted so the row and
  // the default agent always agree.
  async function setAsDefault(id: string, fallbackModelId?: string) {
    const config = getConfig(id);
    const modelId = config.lastModelId ?? fallbackModelId;
    if (!modelId) return;
    if (!config.lastModelId) await updateProviderConfig(id, { lastModelId: modelId });
    defaultAgentErrors = { ...defaultAgentErrors, [id]: '' };
    try {
      await agentService.upsertDefaultAgent(id, modelId);
    } catch {
      defaultAgentErrors = {
        ...defaultAgentErrors,
        [id]: 'Could not set this as the default AI agent.',
      };
    }
  }

  /**
   * Auto-star the just-configured provider when there is no current default
   * agent. Runs right after a model selection persists, so the user only
   * had to choose a provider and a model to end up with a working default —
   * no extra "click the star" step.
   *
   * Intentionally a NO-OP when a default already exists, so adding a
   * second provider never silently swaps the user's preferred default
   * out from under them. They still have to click the star to switch.
   */
  async function maybeAutoSetAsDefault(id: string, modelId: string) {
    if (agentService.getDefaultAgent()) return;
    try {
      await agentService.upsertDefaultAgent(id, modelId);
    } catch {
      defaultAgentErrors = {
        ...defaultAgentErrors,
        [id]: 'Could not auto-set the default AI agent. You can pick it manually with the star.',
      };
    }
  }

  async function removeProvider(id: string) {
    removeErrors = { ...removeErrors, [id]: '' };
    let blockedReason: string | null;
    try {
      blockedReason = await agentsProviderRemovalBlockers(id, allPlugins, settings.providers);
    } catch {
      removeErrors = {
        ...removeErrors,
        [id]: 'Could not check whether this provider is safe to remove.',
      };
      return;
    }
    if (blockedReason) {
      removeErrors = { ...removeErrors, [id]: blockedReason };
      return;
    }

    const wasDefault = isDefault(id);
    const nextProviders = { ...settings.providers };
    delete nextProviders[id];
    // Clear config for this provider
    settingsService.updateSettings('ai', {
      providers: nextProviders,
    });

    if (wasDefault) {
      // Find first remaining configured provider (after removal)
      const remaining = configuredIds.filter((rid) => rid !== id);
      if (remaining.length > 0) {
        const nextId = remaining[0];
        const nextModel = getConfig(nextId).lastModelId;
        if (nextModel) {
          try {
            await agentService.upsertDefaultAgent(nextId, nextModel);
          } catch {
            defaultAgentErrors = {
              ...defaultAgentErrors,
              [nextId]: 'Could not update the default agent after removing its previous provider.',
            };
          }
        }
      } else {
        // No providers remain — clear default agent
        await settingsService.updateSettings('ai', { defaultAgentId: null });
      }
    }
  }

  function addProviderRow() {
    draftActive = true;
    draftPickedId = null;
  }

  function onDraftProviderPick(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value as ProviderId;
    if (!val) return;
    draftPickedId = val;
    const plugin = allPlugins.find((p) => p.id === val);
    if (!plugin) return;
    const newId = `${val}_${crypto.randomUUID().slice(0, 8)}`;
    const newConfig = configForNewProvider(plugin, {
      enabled: true,
      name: plugin.name,
      providerType: val,
    });
    // Persist immediately with enabled: true
    settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [newId]: newConfig,
      },
    });
    // Auto-expand the newly added row so the user can configure it immediately
    expandedRows = { ...expandedRows, [newId]: true };
    // Draft row is now a real row
    draftActive = false;
    draftPickedId = null;
  }

  function cancelDraft() {
    draftActive = false;
    draftPickedId = null;
  }

  /** Plugins available for the draft row dropdown */
  let availableForDraft = $derived(availableProvidersForNewRow(allPlugins, configuredIds));
</script>

{#if mode === 'full'}
  <SettingsPaneHeader title="AI" subtitle="Configure assistant behavior and model providers." />
{/if}

<div class="ai-tab">
  {#if mode === 'full'}
    <div class="section-header">Behavior</div>
    <div id="ai-behavior" class="anchor-group">
      <SettingsCard>
        <div class="no-separators">
          <SettingsForm>
            <SettingsFormRow label="Tab continues last thread" separator>
              <Toggle
                checked={settings.tabContinuesLastThread}
                onchange={() =>
                  handler!.handleToggleTabContinuesLastThread(!settings.tabContinuesLastThread)}
              />
            </SettingsFormRow>
          </SettingsForm>
        </div>
      </SettingsCard>
    </div>
  {/if}

  {#if mode === 'full'}
    <div class="section-header">Providers</div>
  {/if}

  <!-- Provider rows -->
  <div id={mode === 'full' ? 'ai-providers' : undefined} class="anchor-group">
    <SettingsCard>
      <div class="providers-section">
        {#if configuredIds.length === 0 && !draftActive}
          <EmptyState compact bordered message="No AI provider configured yet">
            <Button onclick={addProviderRow}>+ Add provider</Button>
          </EmptyState>
        {:else}
          <!-- Top toolbar: explanation on the left, Add button on the right -->
          <div class="providers-toolbar">
            <p class="providers-hint">
              The <span class="hint-star">★</span> provider is what Asyar Assistant uses when you press
              Tab in the launcher.
            </p>
            {#if !draftActive && availableForDraft.length > 0}
              <button class="add-provider-btn" onclick={addProviderRow}>+ Add provider</button>
            {/if}
          </div>

          {#each configuredIds as providerId (providerId)}
            {@const plugin = getPlugin(providerId)}
            {@const config = getConfig(providerId)}
            {@const cachedModels = modelCache[providerId] ?? []}
            {@const isFetching = !!fetchingModels[providerId]}
            {@const fetchError = fetchErrors[providerId] ?? ''}
            {@const removeError = removeErrors[providerId] ?? ''}
            {@const defaultAgentError = defaultAgentErrors[providerId] ?? ''}
            {@const defaultRow = isDefault(providerId)}
            {@const canBeDefault = !!config.lastModelId || cachedModels.length > 0}
            {@const useCustomInput = customModelMode[providerId] ?? false}
            {@const openAIApiMode = config.openAIApiMode ?? 'chat-completions'}
            {@const selectedModelId = config.lastModelId ?? cachedModels[0]?.id}
            {@const reasoningEfforts = reasoningEffortsForModel(
              plugin,
              cachedModels,
              selectedModelId,
            )}

            {@const expanded = isExpanded(providerId)}
            <div class="provider-row" class:is-default={defaultRow}>
              <!-- Row header: chevron + provider name (clickable to toggle) + star + remove -->
              <div class="row-header">
                <button
                  class="row-toggle"
                  onclick={() => toggleExpanded(providerId)}
                  aria-expanded={expanded}
                  aria-controls="row-body-{providerId}"
                >
                  <span class="row-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <span class="provider-label">{config.name || plugin?.name || providerId}</span>
                  {#if config.name && plugin && config.name !== plugin.name}
                    <span class="provider-type-badge">{plugin.name}</span>
                  {/if}
                  {#if !expanded && config.lastModelId}
                    <span class="row-summary">{config.lastModelId}</span>
                  {/if}
                </button>
                <div class="row-actions">
                  <!-- Default star -->
                  <button
                    class="star-btn"
                    class:is-filled={defaultRow}
                    disabled={!canBeDefault}
                    title={canBeDefault
                      ? defaultRow
                        ? 'Default provider'
                        : 'Set as default'
                      : 'Fetch a model first'}
                    onclick={() => setAsDefault(providerId, selectedModelId)}
                    aria-label={defaultRow ? 'Default provider' : 'Set as default'}
                  >
                    {defaultRow ? '★' : '☆'}
                  </button>
                  <!-- Remove -->
                  <button
                    class="remove-btn"
                    onclick={() => removeProvider(providerId)}
                    aria-label="Remove {config.name || plugin?.name || providerId}"
                    title="Remove provider"
                  >
                    ×
                  </button>
                </div>
              </div>

              {#if removeError}
                <div class="row-banner">
                  <InlineError message={removeError} />
                </div>
              {/if}
              {#if defaultAgentError}
                <div class="row-banner">
                  <InlineError message={defaultAgentError} />
                </div>
              {/if}

              {#if expanded}
                <div class="row-body" id="row-body-{providerId}">
                  <div class="card-field">
                    <label class="field-label" for="name-{providerId}">Name</label>
                    <Input
                      unstyled
                      textIntent="exact"
                      class="card-input"
                      id="name-{providerId}"
                      type="text"
                      value={config.name ?? plugin?.name ?? ''}
                      placeholder={plugin?.name ?? 'Provider connection name'}
                      autocomplete="off"
                      onblur={(e) =>
                        updateProviderConfig(providerId, {
                          name: (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                        })}
                    />
                  </div>

                  {#if plugin?.requiresApiKey || plugin?.optionalApiKey}
                    <div class="card-field">
                      <label class="field-label" for="apikey-{providerId}">
                        API Key{#if !plugin?.requiresApiKey}
                          <span class="field-hint">(optional)</span>{/if}
                      </label>
                      <Input
                        unstyled
                        textIntent="exact"
                        class="card-input"
                        id="apikey-{providerId}"
                        type="password"
                        value={config.apiKey ?? ''}
                        placeholder={plugin?.requiresApiKey
                          ? 'sk-••••••••••••••••'
                          : 'Leave blank for unsecured endpoints'}
                        autocomplete="off"
                        onblur={(e) =>
                          updateProviderConfig(providerId, {
                            apiKey: (e.currentTarget as HTMLInputElement).value || undefined,
                          })}
                      />
                    </div>
                  {/if}

                  {#if plugin?.requiresBaseUrl}
                    <div class="card-field">
                      <label class="field-label" for="baseurl-{providerId}">Base URL</label>
                      <Input
                        unstyled
                        textIntent="exact"
                        class="card-input"
                        id="baseurl-{providerId}"
                        type="url"
                        value={config.baseUrl ?? ''}
                        placeholder={providerId === 'ollama'
                          ? 'http://localhost:11434'
                          : 'https://your-api.example.com'}
                        onblur={(e) =>
                          updateProviderConfig(providerId, {
                            baseUrl: (e.currentTarget as HTMLInputElement).value || undefined,
                          })}
                      />
                    </div>
                  {/if}

                  {#if plugin?.supportsOpenAIApiMode}
                    <div class="card-field">
                      <label class="field-label" for="openai-api-mode-{providerId}"
                        >API format</label
                      >
                      <select
                        class="card-select"
                        id="openai-api-mode-{providerId}"
                        value={openAIApiMode}
                        onchange={(e) =>
                          updateProviderConfig(providerId, {
                            openAIApiMode: (e.currentTarget as HTMLSelectElement)
                              .value as OpenAIApiMode,
                          })}
                      >
                        <option value="responses">Responses (recommended)</option>
                        <option value="chat-completions"
                          >Chat Completions (widely compatible)</option
                        >
                      </select>
                      <p class="field-description">
                        Responses supports hosted tools and typed streaming. Use Chat Completions
                        when an endpoint does not implement <code>/responses</code>.
                      </p>
                    </div>
                  {/if}

                  {#if plugin?.supportsHostedWebSearch && (providerId !== 'openai' || openAIApiMode === 'responses')}
                    <div class="hosted-search-setting">
                      <div class="hosted-search-heading">
                        <label class="field-label" for="hosted-web-search-{providerId}">
                          OpenAI Hosted Web Search
                        </label>
                        <Toggle
                          id="hosted-web-search-{providerId}"
                          checked={config.hostedWebSearch === true}
                          onchange={(e) =>
                            updateProviderConfig(providerId, {
                              hostedWebSearch: (e.currentTarget as HTMLInputElement).checked,
                            })}
                        />
                      </div>
                      <p class="field-description">
                        Lets compatible OpenAI/Codex proxy endpoints search the live web. No
                        separate search API key is needed; unsupported endpoints may reject requests
                        while this is enabled.
                      </p>
                    </div>
                  {/if}

                  <!-- Test & Fetch button -->
                  <div class="card-actions">
                    <Button
                      onclick={() => plugin && fetchModels(providerId, plugin)}
                      disabled={isFetching || !canTestAndFetch(plugin ?? null, config)}
                    >
                      {isFetching ? 'Fetching…' : 'Test & Fetch Models'}
                    </Button>
                  </div>

                  {#if fetchError}
                    <InlineError message={fetchError} />
                  {/if}

                  <!-- Model picker -->
                  {#if cachedModels.length > 0 && !useCustomInput}
                    <div class="card-field">
                      <label class="field-label" for="model-{providerId}">Model</label>
                      <select
                        class="card-select"
                        id="model-{providerId}"
                        value={config.lastModelId ?? cachedModels[0]?.id}
                        onchange={async (e) => {
                          const val = (e.currentTarget as HTMLSelectElement).value;
                          if (val === '__custom__') {
                            customModelMode = { ...customModelMode, [providerId]: true };
                            return;
                          }
                          updateProviderConfig(providerId, {
                            lastModelId: val,
                            reasoningEffort: reasoningEffortAfterModelChange(
                              plugin,
                              cachedModels,
                              val,
                              config.reasoningEffort,
                            ),
                          });
                          if (isDefault(providerId)) {
                            try {
                              await agentService.upsertDefaultAgent(providerId, val);
                            } catch {
                              defaultAgentErrors = {
                                ...defaultAgentErrors,
                                [providerId]: 'Could not update the default AI agent.',
                              };
                            }
                          } else {
                            await maybeAutoSetAsDefault(providerId, val);
                          }
                        }}
                      >
                        {#each cachedModels as m (m.id)}
                          <option value={m.id}>{m.label}</option>
                        {/each}
                        <option value="__custom__">Enter a custom model id…</option>
                      </select>
                    </div>
                  {:else if useCustomInput || fetchError || (!cachedModels.length && !isFetching && !plugin?.requiresApiKey && !plugin?.requiresBaseUrl)}
                    <div class="card-field">
                      <label class="field-label" for="model-manual-{providerId}">
                        Model
                        {#if fetchError}<span class="field-hint"
                            >(fetch failed — enter manually)</span
                          >{/if}
                      </label>
                      <div class="model-manual-row">
                        <Input
                          unstyled
                          textIntent="exact"
                          class="card-input"
                          id="model-manual-{providerId}"
                          type="text"
                          value={config.lastModelId ?? ''}
                          placeholder="e.g. gpt-4o or llama3.2"
                          onblur={async (e) => {
                            const val = (e.currentTarget as HTMLInputElement).value.trim();
                            if (val) {
                              updateProviderConfig(providerId, {
                                lastModelId: val,
                                reasoningEffort: reasoningEffortAfterModelChange(
                                  plugin,
                                  cachedModels,
                                  val,
                                  config.reasoningEffort,
                                ),
                              });
                              if (isDefault(providerId)) {
                                try {
                                  await agentService.upsertDefaultAgent(providerId, val);
                                } catch {
                                  defaultAgentErrors = {
                                    ...defaultAgentErrors,
                                    [providerId]: 'Could not update the default AI agent.',
                                  };
                                }
                              } else {
                                await maybeAutoSetAsDefault(providerId, val);
                              }
                            }
                          }}
                        />
                        {#if useCustomInput && cachedModels.length > 0}
                          <button
                            class="text-btn"
                            onclick={() =>
                              (customModelMode = { ...customModelMode, [providerId]: false })}
                          >
                            Back to list
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/if}

                  {#if reasoningEfforts.length > 0 && selectedModelId}
                    <div class="card-field">
                      <label class="field-label" for="reasoning-effort-{providerId}"
                        >Reasoning</label
                      >
                      <select
                        class="card-select"
                        id="reasoning-effort-{providerId}"
                        value={config.reasoningEffort ?? ''}
                        onchange={(e) => {
                          const value = (e.currentTarget as HTMLSelectElement).value;
                          updateProviderConfig(providerId, {
                            reasoningEffort: value ? (value as ReasoningEffort) : undefined,
                          });
                        }}
                      >
                        <option value="">Model default</option>
                        {#each reasoningEfforts as effort (effort)}
                          <option value={effort}>{reasoningEffortLabel(effort)}</option>
                        {/each}
                      </select>
                      <p class="field-description">
                        Higher levels can improve difficult answers but usually take longer.
                        Available levels depend on the selected model.
                      </p>
                    </div>
                  {/if}

                  <div class="card-field">
                    <div class="field-header-row">
                      <label class="field-label" for="temp-{providerId}">
                        Temperature: {(config.temperature ?? 0.7).toFixed(2)}
                      </label>
                      {#if config.temperature !== undefined && config.temperature !== 0.7}
                        <button
                          class="text-btn"
                          onclick={() => updateProviderConfig(providerId, { temperature: 0.7 })}
                        >
                          Reset (0.70)
                        </button>
                      {/if}
                    </div>
                    <input
                      class="field-range"
                      id="temp-{providerId}"
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={config.temperature ?? 0.7}
                      oninput={(e) =>
                        updateProviderConfig(providerId, {
                          temperature: parseFloat((e.currentTarget as HTMLInputElement).value),
                        })}
                    />
                  </div>

                  <div class="card-field">
                    <div class="field-header-row">
                      <label class="field-label" for="maxtokens-{providerId}"> Max Tokens </label>
                      {#if config.maxTokens !== undefined && config.maxTokens !== 2048}
                        <button
                          class="text-btn"
                          onclick={() => updateProviderConfig(providerId, { maxTokens: 2048 })}
                        >
                          Reset (2048)
                        </button>
                      {/if}
                    </div>
                    <Input
                      unstyled
                      textIntent="exact"
                      class="card-input"
                      id="maxtokens-{providerId}"
                      type="number"
                      value={config.maxTokens !== undefined ? String(config.maxTokens) : '2048'}
                      placeholder="2048"
                      min="128"
                      max="32768"
                      step="128"
                      onblur={(e) => {
                        const val = parseInt((e.currentTarget as HTMLInputElement).value);
                        updateProviderConfig(providerId, {
                          maxTokens: !isNaN(val) && val > 0 ? val : 2048,
                        });
                      }}
                    />
                  </div>
                </div>
              {/if}
            </div>
          {/each}

          <!-- Draft row (in-progress, not yet persisted) -->
          {#if draftActive}
            <div class="provider-row draft-row">
              <div class="row-header">
                <select class="card-select provider-picker" value="" onchange={onDraftProviderPick}>
                  <option value="" disabled>Choose provider…</option>
                  {#each availableForDraft as p (p.id)}
                    <option value={p.id}>{p.name}</option>
                  {/each}
                </select>
                <button class="remove-btn" onclick={cancelDraft} aria-label="Cancel">×</button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </SettingsCard>
  </div>
</div>

<style>
  .ai-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .providers-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .providers-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
  }

  .providers-hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.4;
  }

  .hint-star {
    color: var(--accent-primary);
  }

  /* Provider rows */
  .provider-row {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-secondary);
    transition: border-color var(--transition-smooth);
  }

  .provider-row.is-default {
    border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--border-color));
  }

  .row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-2);
  }

  .row-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    min-width: 0;
  }

  .row-chevron {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    width: 1ch;
    flex: 0 0 auto;
  }

  .row-summary {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    margin-left: var(--space-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .provider-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .provider-type-badge {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-1);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .star-btn {
    background: none;
    border: none;
    padding: var(--space-1);
    cursor: pointer;
    font-size: var(--font-size-xl);
    line-height: 1;
    color: var(--text-tertiary);
    transition:
      color var(--transition-smooth),
      opacity var(--transition-smooth);
    border-radius: var(--radius-sm);
  }

  .star-btn:hover:not(:disabled) {
    color: var(--accent-primary);
  }

  .star-btn.is-filled {
    color: var(--accent-primary);
  }

  .star-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .remove-btn {
    background: none;
    border: none;
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
    font-size: var(--font-size-xl);
    line-height: 1;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition:
      color var(--transition-smooth),
      background var(--transition-smooth);
  }

  .remove-btn:hover {
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }

  .row-body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 1px solid var(--border-color);
  }

  .card-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .field-hint {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .hosted-search-setting {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
  }

  .hosted-search-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .field-description {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.4;
  }

  :global(.card-input) {
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--transition-smooth);
  }

  :global(.card-input):focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .card-select {
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    cursor: pointer;
  }

  .card-actions {
    display: flex;
    gap: var(--space-2);
  }

  /* Sits between the row header and the (possibly collapsed) row body, so a
     blocked removal or a default-agent update failure is visible without
     expanding the row. */
  .row-banner {
    padding: 0 var(--space-3) var(--space-2);
  }

  /* Draft row */
  .draft-row .row-header {
    border-bottom: none;
  }

  .provider-picker {
    flex: 1;
  }

  /* Add provider button */
  .add-provider-btn {
    background: none;
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    text-align: center;
    width: 100%;
    transition:
      color var(--transition-smooth),
      border-color var(--transition-smooth);
  }

  .add-provider-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  .model-manual-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  :global(.model-manual-row .card-input) {
    flex: 1;
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--accent-primary);
    font-size: var(--font-size-xs);
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
    text-decoration: underline;
  }

  .anchor-group {
    scroll-margin-top: var(--space-6);
  }

  .no-separators :global(.form-row) {
    border-bottom: none;
  }

  .no-separators :global(.form-row.separator) {
    border-top: none;
  }
</style>
