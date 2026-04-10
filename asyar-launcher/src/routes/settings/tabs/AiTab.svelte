<script lang="ts">
  import { SettingsForm, SettingsFormRow, Toggle, Button, Input } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { listProviders } from '../../../services/ai/providerRegistry';
  import type { IProviderPlugin, ModelInfo, ProviderConfig } from '../../../services/ai/IProviderPlugin';
  import type { ProviderId } from '../../../services/settings/types/AppSettingsType';

  let settings = $derived(settingsService.currentSettings.ai);

  // Session-cached model lists — not persisted, re-fetched on next launch
  let modelCache = $state<Record<string, ModelInfo[]>>({});
  let fetchingModels = $state<Record<string, boolean>>({});
  let fetchErrors = $state<Record<string, string>>({});

  // Local state for advanced settings
  let systemPrompt = $state(settings.systemPrompt ?? '');
  let maxTokensStr = $state(String(settings.maxTokens));
  let temperature = $state(settings.temperature);
  let showAdvanced = $state(false);

  // Keep local state in sync when settings change externally (e.g. profile sync import)
  $effect(() => {
    systemPrompt = settings.systemPrompt ?? '';
    maxTokensStr = String(settings.maxTokens);
    temperature = settings.temperature;
  });

  let providers = $derived(listProviders());

  function getConfig(providerId: ProviderId): ProviderConfig {
    return settings.providers[providerId] ?? { enabled: false };
  }

  function updateProviderConfig(providerId: ProviderId, partial: Partial<ProviderConfig>) {
    settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [providerId]: { ...getConfig(providerId), ...partial },
      },
    });
  }

  function toggleProvider(plugin: IProviderPlugin) {
    const current = getConfig(plugin.id);
    updateProviderConfig(plugin.id, { enabled: !current.enabled });
    // If disabling the active provider, clear active selection
    if (current.enabled && settings.activeProviderId === plugin.id) {
      settingsService.updateSettings('ai', { activeProviderId: null, activeModelId: null });
    }
  }

  async function fetchModels(plugin: IProviderPlugin) {
    fetchingModels = { ...fetchingModels, [plugin.id]: true };
    fetchErrors = { ...fetchErrors, [plugin.id]: '' };
    try {
      const models = await plugin.getModels(getConfig(plugin.id));
      modelCache = { ...modelCache, [plugin.id]: models };
      if (fetchErrors[plugin.id]) {
        fetchErrors = { ...fetchErrors, [plugin.id]: '' };
      }
    } catch (e: unknown) {
      fetchErrors = {
        ...fetchErrors,
        [plugin.id]: e instanceof Error ? e.message : 'Failed to fetch models',
      };
    } finally {
      fetchingModels = { ...fetchingModels, [plugin.id]: false };
    }
  }

  function selectProviderAndModel(providerId: ProviderId, modelId: string | null) {
    settingsService.updateSettings('ai', {
      activeProviderId: providerId,
      activeModelId: modelId,
      // Persist per-provider last-used model so switching back restores the selection
      providers: {
        ...settings.providers,
        [providerId]: { ...getConfig(providerId), lastModelId: modelId ?? undefined },
      },
    });
  }

  function isActive(providerId: ProviderId): boolean {
    return settings.activeProviderId === providerId;
  }

  // Expanded provider card state
  let expandedProvider = $state<ProviderId | null>(null);

  function toggleExpanded(plugin: IProviderPlugin) {
    const isOpening = expandedProvider !== plugin.id;
    expandedProvider = isOpening ? plugin.id : null;
    // Auto-fetch models if expanding and cache is empty but credentials are present
    if (isOpening && !modelCache[plugin.id]?.length && !fetchingModels[plugin.id]) {
      const config = getConfig(plugin.id);
      const hasCredentials =
        (!plugin.requiresApiKey || !!config.apiKey?.trim()) &&
        (!plugin.requiresBaseUrl || !!config.baseUrl?.trim());
      if (hasCredentials) {
        fetchModels(plugin);
      }
    }
  }

  function saveGlobal(partial: Partial<typeof settings>) {
    settingsService.updateSettings('ai', { ...settings, ...partial });
  }
</script>

<div class="ai-tab">
  <!-- Active provider/model selector -->
  {#if settings.activeProviderId}
    {@const activePlugin = providers.find(p => p.id === settings.activeProviderId)}
    {#if activePlugin}
      <div class="active-banner">
        <span class="active-label">Active:</span>
        <span class="active-provider">{activePlugin.name}</span>
        {#if settings.activeModelId}
          <span class="active-separator">·</span>
          <span class="active-model">{settings.activeModelId}</span>
        {/if}
        <button class="clear-btn" onclick={() => settingsService.updateSettings('ai', { activeProviderId: null, activeModelId: null })}>
          ✕
        </button>
      </div>
    {/if}
  {:else}
    <div class="no-active-note">No active provider selected — enable and configure a provider below.</div>
  {/if}

  <!-- Provider cards -->
  <div class="providers-section">
    {#each providers as plugin (plugin.id)}
      {@const config = getConfig(plugin.id)}
      {@const cachedModels = modelCache[plugin.id] ?? []}
      {@const isFetching = !!fetchingModels[plugin.id]}
      {@const fetchError = fetchErrors[plugin.id] ?? ''}
      {@const expanded = expandedProvider === plugin.id}
      {@const active = isActive(plugin.id)}

      <div class="provider-card" class:enabled={config.enabled} class:active>
        <!-- Card header — click anywhere except the toggle to expand -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="card-header" onclick={() => toggleExpanded(plugin)}>
          <div class="card-header-left">
            <!-- stopPropagation so toggling enabled/disabled doesn't also expand -->
            <div onclick={(e) => e.stopPropagation()} role="none">
              <Toggle
                id="toggle-{plugin.id}"
                checked={config.enabled}
                onchange={() => toggleProvider(plugin)}
              />
            </div>
            <span class="provider-name">{plugin.name}</span>
            {#if active}
              <span class="active-badge">Active</span>
            {/if}
          </div>
          <span class="expand-btn" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </div>

        <!-- Expanded card body -->
        {#if expanded}
          <div class="card-body">
            {#if plugin.requiresApiKey}
              <div class="card-field">
                <label class="field-label" for="apikey-{plugin.id}">API Key</label>
                <input
                  class="card-input"
                  id="apikey-{plugin.id}"
                  type="password"
                  value={config.apiKey ?? ''}
                  placeholder="sk-••••••••••••••••"
                  autocomplete="off"
                  onblur={(e) => updateProviderConfig(plugin.id, { apiKey: (e.currentTarget as HTMLInputElement).value })}
                />
              </div>
            {/if}

            {#if plugin.requiresBaseUrl}
              <div class="card-field">
                <label class="field-label" for="baseurl-{plugin.id}">Base URL</label>
                <input
                  class="card-input"
                  id="baseurl-{plugin.id}"
                  type="url"
                  value={config.baseUrl ?? ''}
                  placeholder={plugin.id === 'ollama' ? 'http://localhost:11434' : 'https://your-api.example.com'}
                  onblur={(e) => updateProviderConfig(plugin.id, { baseUrl: (e.currentTarget as HTMLInputElement).value || undefined })}
                />
              </div>
            {/if}

            <!-- Test & fetch models -->
            <div class="card-actions">
              <Button onclick={() => fetchModels(plugin)} disabled={isFetching}>
                {isFetching ? 'Fetching…' : 'Test & Fetch Models'}
              </Button>
            </div>

            {#if fetchError}
              <p class="fetch-error">{fetchError}</p>
            {/if}

            <!-- Model selector -->
            {#if cachedModels.length > 0}
              <div class="card-field">
                <label class="field-label" for="model-{plugin.id}">Model</label>
                <select
                  class="card-select"
                  id="model-{plugin.id}"
                  value={active ? (settings.activeModelId ?? config.lastModelId ?? cachedModels[0]?.id) : (config.lastModelId ?? cachedModels[0]?.id)}
                  onchange={(e) => selectProviderAndModel(plugin.id, (e.currentTarget as HTMLSelectElement).value)}
                >
                  {#each cachedModels as m (m.id)}
                    <option value={m.id}>{m.label}</option>
                  {/each}
                </select>
              </div>
            {:else if plugin.id === 'custom' || plugin.id === 'ollama'}
              <div class="card-field">
                <label class="field-label" for="model-manual-{plugin.id}">Model</label>
                <input
                  class="card-input"
                  id="model-manual-{plugin.id}"
                  type="text"
                  value={active ? (settings.activeModelId ?? config.lastModelId ?? '') : (config.lastModelId ?? '')}
                  placeholder="e.g. llama3.2 or custom-model-id"
                  onblur={(e) => {
                    const val = (e.currentTarget as HTMLInputElement).value.trim();
                    if (val) selectProviderAndModel(plugin.id, val);
                  }}
                />
              </div>
            {/if}

          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Extension access toggle -->
  <div class="section-divider" />
  <div class="no-separators">
    <SettingsForm>
      <SettingsFormRow label="Extension AI Access" separator>
        <Toggle
          checked={settings.allowExtensionUse}
          onchange={() => saveGlobal({ allowExtensionUse: !settings.allowExtensionUse })}
        />
      </SettingsFormRow>
    </SettingsForm>
  </div>

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

          <SettingsFormRow label="System Prompt">
            <textarea
              class="field-textarea"
              bind:value={systemPrompt}
              rows={4}
              placeholder="You are a helpful assistant."
              onblur={() => saveGlobal({ systemPrompt: systemPrompt || undefined })}
            ></textarea>
          </SettingsFormRow>
        </SettingsForm>
      </div>
    {/if}
  </div>
</div>

<style>
  .ai-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .active-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
  }

  .active-label {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }

  .active-provider {
    color: var(--text-primary);
    font-weight: 600;
  }

  .active-separator {
    color: var(--text-tertiary);
  }

  .active-model {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  .clear-btn {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    padding: 0 var(--space-1);
    transition: color var(--transition-smooth);
  }

  .clear-btn:hover {
    color: var(--text-primary);
  }

  .no-active-note {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    padding: var(--space-2) 0;
  }

  .providers-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .provider-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    transition: border-color var(--transition-smooth);
  }

  .provider-card.enabled {
    border-color: var(--border-active, var(--accent-primary));
    border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--border-color));
  }

  .provider-card.active {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-3);
    background: var(--bg-secondary);
    cursor: pointer;
    user-select: none;
  }

  .card-header-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .provider-name {
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 500;
  }

  .active-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: var(--radius-full, 999px);
    background: var(--accent-primary);
    color: white;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .expand-btn {
    color: var(--text-secondary);
    font-size: 18px;
    font-weight: 600;
    padding: 0 var(--space-1);
    flex-shrink: 0;
    line-height: 1;
  }

  .card-body {
    padding: var(--space-3);
    border-top: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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

  .card-input {
    padding: var(--space-2) var(--space-2);
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
    padding: var(--space-2) var(--space-2);
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
