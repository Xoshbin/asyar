<script lang="ts">
  import { SettingsForm, SettingsFormRow, Toggle, Button, Input } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { listProviders } from '../../../services/ai/providerRegistry';
  import { agentService } from '../../../built-in-features/agents/agentService.svelte';
  import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';
  import { availableProvidersForNewRow, canTestAndFetch } from './AiTab.helpers';
  import type { IProviderPlugin, ModelInfo, ProviderConfig } from '../../../services/ai/IProviderPlugin';
  import type { ProviderId } from '../../../services/settings/types/AppSettingsType';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
    mode = 'full',
  }: { handler?: SettingsHandler; mode?: 'full' | 'providers-only' } = $props();

  let settings = $derived(settingsService.currentSettings.ai);

  // Session-cached model lists — not persisted, re-fetched on next launch
  let modelCache = $state<Record<string, ModelInfo[]>>({});
  let fetchingModels = $state<Record<string, boolean>>({});
  let fetchErrors = $state<Record<string, string>>({});
  // Track custom-model-id input mode per provider
  let customModelMode = $state<Record<string, boolean>>({});

  // Advanced settings local state
  let maxTokensStr = $state(String(settings.maxTokens));
  let temperature = $state(settings.temperature);
  let showAdvanced = $state(false);

  // Draft row: a new row the user started via "+ Add" but hasn't committed yet
  let draftActive = $state(false);
  let draftPickedId = $state<ProviderId | null>(null);

  // Per-row expand/collapse state. Already-configured rows start collapsed;
  // newly-added rows auto-expand so the user can fill in credentials.
  let expandedRows = $state<Record<string, boolean>>({});

  function isExpanded(id: ProviderId): boolean {
    return expandedRows[id] === true;
  }

  function toggleExpanded(id: ProviderId) {
    expandedRows = { ...expandedRows, [id]: !expandedRows[id] };
  }

  // Keep local state in sync when settings change externally
  $effect(() => {
    maxTokensStr = String(settings.maxTokens);
    temperature = settings.temperature;
  });

  // Ensure agents are loaded
  $effect(() => {
    agentService.init().catch(() => {
      // init already reports its own diagnostic
    });
  });

  let allPlugins = $derived(listProviders());

  /** Provider IDs that have enabled: true in settings */
  let configuredIds = $derived(
    (Object.keys(settings.providers) as ProviderId[]).filter(
      (id) => settings.providers[id]?.enabled === true,
    ),
  );

  function getPlugin(id: ProviderId): IProviderPlugin | undefined {
    return allPlugins.find((p) => p.id === id);
  }

  function getConfig(id: ProviderId): ProviderConfig {
    return settings.providers[id] ?? { enabled: false };
  }

  function updateProviderConfig(id: ProviderId, partial: Partial<ProviderConfig>) {
    settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [id]: { ...getConfig(id), ...partial },
      },
    });
  }

  async function fetchModels(plugin: IProviderPlugin) {
    fetchingModels = { ...fetchingModels, [plugin.id]: true };
    fetchErrors = { ...fetchErrors, [plugin.id]: '' };
    try {
      const models = await plugin.getModels(getConfig(plugin.id));
      modelCache = { ...modelCache, [plugin.id]: models };
      fetchErrors = { ...fetchErrors, [plugin.id]: '' };
    } catch (e: unknown) {
      fetchErrors = {
        ...fetchErrors,
        [plugin.id]: e instanceof Error ? e.message : 'Failed to fetch models',
      };
      modelCache = { ...modelCache, [plugin.id]: [] };
    } finally {
      fetchingModels = { ...fetchingModels, [plugin.id]: false };
    }
  }

  function isDefault(id: ProviderId): boolean {
    const agent = agentService.getDefaultAgent();
    return agent?.providerId === id;
  }

  async function setAsDefault(id: ProviderId) {
    const config = getConfig(id);
    const modelId = config.lastModelId;
    if (!modelId) return;
    try {
      await agentService.upsertDefaultAgent(id, modelId);
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: 'Could not set default AI agent.' },
        developerDetail: String(err),
      });
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
  async function maybeAutoSetAsDefault(id: ProviderId, modelId: string) {
    if (agentService.getDefaultAgent()) return;
    try {
      await agentService.upsertDefaultAgent(id, modelId);
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: {
          message: 'Could not auto-set the default AI agent. You can pick it manually with the star.',
        },
        developerDetail: String(err),
      });
    }
  }

  async function removeProvider(id: ProviderId) {
    const wasDefault = isDefault(id);
    // Clear config for this provider
    settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [id]: { enabled: false },
      },
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
          } catch (err) {
            diagnosticsService.report({
              source: 'frontend',
              kind: 'manual',
              severity: 'error',
              retryable: true,
              context: { message: 'Could not update default agent after removing provider.' },
              developerDetail: String(err),
            });
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
    // Persist immediately with enabled: true
    settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [val]: { ...getConfig(val), enabled: true },
      },
    });
    // Auto-expand the newly added row so the user can configure it immediately
    expandedRows = { ...expandedRows, [val]: true };
    // Draft row is now a real row
    draftActive = false;
    draftPickedId = null;
  }

  function cancelDraft() {
    draftActive = false;
    draftPickedId = null;
  }

  /** Plugins not yet added — used for the draft row dropdown */
  let availableForDraft = $derived(availableProvidersForNewRow(allPlugins, configuredIds));

  function saveGlobal(partial: Partial<typeof settings>) {
    settingsService.updateSettings('ai', { ...settings, ...partial });
  }
</script>

<div class="ai-tab">
  {#if mode === 'full'}
    <div class="no-separators">
      <SettingsForm>
        <SettingsFormRow label="Tab continues last thread" separator>
          <Toggle
            checked={settings.tabContinuesLastThread}
            onchange={() => handler!.handleToggleTabContinuesLastThread(!settings.tabContinuesLastThread)}
          />
        </SettingsFormRow>
      </SettingsForm>
    </div>

    <div class="section-divider" />
  {/if}

  <!-- Provider rows -->
  <div class="providers-section">
    {#if configuredIds.length === 0 && !draftActive}
      <!-- Empty state -->
      <div class="empty-state">
        <p class="empty-state-text">No AI provider configured yet</p>
        <Button onclick={addProviderRow}>+ Add provider</Button>
      </div>
    {:else}
      <!-- Top toolbar: explanation on the left, Add button on the right -->
      <div class="providers-toolbar">
        <p class="providers-hint">
          The <span class="hint-star">★</span> provider is what Asyar Assistant uses when you press Tab in the launcher.
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
        {@const defaultRow = isDefault(providerId)}
        {@const hasModel = !!config.lastModelId}
        {@const useCustomInput = customModelMode[providerId] ?? false}

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
              <span class="provider-label">{plugin?.name ?? providerId}</span>
              {#if !expanded && config.lastModelId}
                <span class="row-summary">{config.lastModelId}</span>
              {/if}
            </button>
            <div class="row-actions">
              <!-- Default star -->
              <button
                class="star-btn"
                class:is-filled={defaultRow}
                disabled={!hasModel}
                title={hasModel ? (defaultRow ? 'Default provider' : 'Set as default') : 'Pick a model first'}
                onclick={() => setAsDefault(providerId)}
                aria-label={defaultRow ? 'Default provider' : 'Set as default'}
              >
                {defaultRow ? '★' : '☆'}
              </button>
              <!-- Remove -->
              <button
                class="remove-btn"
                onclick={() => removeProvider(providerId)}
                aria-label="Remove {plugin?.name ?? providerId}"
                title="Remove provider"
              >
                ×
              </button>
            </div>
          </div>

          {#if expanded}
          <div class="row-body" id="row-body-{providerId}">
            {#if plugin?.requiresApiKey || plugin?.optionalApiKey}
              <div class="card-field">
                <label class="field-label" for="apikey-{providerId}">
                  API Key{#if !plugin?.requiresApiKey} <span class="field-hint">(optional)</span>{/if}
                </label>
                <input
                  class="card-input"
                  id="apikey-{providerId}"
                  type="password"
                  value={config.apiKey ?? ''}
                  placeholder={plugin?.requiresApiKey ? 'sk-••••••••••••••••' : 'Leave blank for unsecured endpoints'}
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
                <input
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

            <!-- Test & Fetch button -->
            <div class="card-actions">
              <Button
                onclick={() => plugin && fetchModels(plugin)}
                disabled={isFetching || !canTestAndFetch(plugin ?? null, config)}
              >
                {isFetching ? 'Fetching…' : 'Test & Fetch Models'}
              </Button>
            </div>

            {#if fetchError}
              <p class="fetch-error">{fetchError}</p>
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
                    updateProviderConfig(providerId, { lastModelId: val });
                    if (isDefault(providerId)) {
                      try {
                        await agentService.upsertDefaultAgent(providerId, val);
                      } catch (err) {
                        diagnosticsService.report({
                          source: 'frontend',
                          kind: 'manual',
                          severity: 'error',
                          retryable: true,
                          context: { message: 'Could not update the default AI agent.' },
                          developerDetail: String(err),
                        });
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
                  {#if fetchError}<span class="field-hint">(fetch failed — enter manually)</span>{/if}
                </label>
                <div class="model-manual-row">
                  <input
                    class="card-input"
                    id="model-manual-{providerId}"
                    type="text"
                    value={config.lastModelId ?? ''}
                    placeholder="e.g. gpt-4o or llama3.2"
                    onblur={async (e) => {
                      const val = (e.currentTarget as HTMLInputElement).value.trim();
                      if (val) {
                        updateProviderConfig(providerId, { lastModelId: val });
                        if (isDefault(providerId)) {
                          try {
                            await agentService.upsertDefaultAgent(providerId, val);
                          } catch (err) {
                            diagnosticsService.report({
                              source: 'frontend',
                              kind: 'manual',
                              severity: 'error',
                              retryable: true,
                              context: { message: 'Could not update the default AI agent.' },
                              developerDetail: String(err),
                            });
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
                      onclick={() => (customModelMode = { ...customModelMode, [providerId]: false })}
                    >
                      Back to list
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
          {/if}
        </div>
      {/each}

      <!-- Draft row (in-progress, not yet persisted) -->
      {#if draftActive}
        <div class="provider-row draft-row">
          <div class="row-header">
            <select
              class="card-select provider-picker"
              value=""
              onchange={onDraftProviderPick}
            >
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

  {#if mode === 'full'}
    <!-- Advanced settings -->
    <div class="advanced-section">
      <button class="text-label advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
        {showAdvanced ? '▾' : '▸'} Advanced
      </button>

      {#if showAdvanced}
        <div class="no-separators">
          <SettingsForm>
            <SettingsFormRow label="Temperature {temperature.toFixed(2)}">
              <input
                class="field-range"
                type="range"
                min="0"
                max="2"
                step="0.05"
                bind:value={temperature}
                oninput={() => saveGlobal({ temperature })}
              />
            </SettingsFormRow>

            <SettingsFormRow label="Max Tokens">
              <Input
                type="number"
                bind:value={maxTokensStr}
                min="128"
                max="32768"
                step="128"
                onblur={() => saveGlobal({ maxTokens: parseInt(maxTokensStr) || settings.maxTokens })}
              />
            </SettingsFormRow>
          </SettingsForm>
        </div>
      {/if}
    </div>
  {/if}
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

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .empty-state-text {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    margin: 0;
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
    font-size: 16px;
    line-height: 1;
    color: var(--text-tertiary);
    transition: color var(--transition-smooth), opacity var(--transition-smooth);
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
    font-size: 16px;
    line-height: 1;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition: color var(--transition-smooth), background var(--transition-smooth);
  }

  .remove-btn:hover {
    color: var(--color-error, #ef4444);
    background: color-mix(in srgb, var(--color-error, #ef4444) 10%, transparent);
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

  .field-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .field-hint {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .card-input {
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

  .card-input:focus {
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

  .fetch-error {
    font-size: var(--font-size-xs);
    color: var(--color-error, #ef4444);
    margin: 0;
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
    transition: color var(--transition-smooth), border-color var(--transition-smooth);
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

  .model-manual-row .card-input {
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

  .section-divider {
    height: 1px;
    background: var(--border-color);
    margin: var(--space-1) 0;
  }

  .no-separators :global(.form-row) {
    border-bottom: none;
  }

  .no-separators :global(.form-row.separator) {
    border-top: none;
  }

  .advanced-section {
    margin-top: var(--space-2);
  }

  .advanced-toggle {
    margin-bottom: var(--space-2);
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    transition: color var(--transition-smooth);
  }

  .advanced-toggle:hover {
    color: var(--text-primary);
  }
</style>
