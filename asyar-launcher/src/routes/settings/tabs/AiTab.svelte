<script lang="ts">
  import { SettingsForm, SettingsFormRow, Toggle, Button, Input } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { PROVIDER_MODELS } from '../../../built-in-features/ai-chat/aiStore.svelte';
  import type { AIProvider } from '../../../built-in-features/ai-chat/aiStore.svelte';

  const PROVIDER_LABELS: Record<AIProvider, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Gemini',
    ollama: 'Ollama (local)',
    openrouter: 'OpenRouter',
    custom: 'Custom (OpenAI-compatible)',
  };

  let settings = $derived(settingsService.currentSettings.ai);

  // Local state for text fields — updated on blur to avoid saving on every keypress
  let apiKey = $state(settings.apiKey);
  let baseUrl = $state(settings.baseUrl ?? '');
  let systemPrompt = $state(settings.systemPrompt ?? '');
  let maxTokensStr = $state(String(settings.maxTokens));
  let temperature = $state(settings.temperature);

  // Keep local state in sync when settings change externally (e.g. profile sync import)
  $effect(() => {
    apiKey = settings.apiKey;
    baseUrl = settings.baseUrl ?? '';
    systemPrompt = settings.systemPrompt ?? '';
    maxTokensStr = String(settings.maxTokens);
    temperature = settings.temperature;
  });

  let showKey = $state(false);
  let showAdvanced = $state(false);

  let models = $derived(PROVIDER_MODELS[settings.provider]);
  let needsBaseUrl = $derived(settings.provider === 'ollama' || settings.provider === 'custom');
  let apiKeyOptional = $derived(settings.provider === 'ollama');

  function save(partial: Partial<typeof settings>) {
    settingsService.updateSettings('ai', { ...settings, ...partial });
  }

  function handleProviderChange(newProvider: AIProvider) {
    const newModels = PROVIDER_MODELS[newProvider];
    const newModel =
      newModels.length > 0 && !newModels.find((m) => m.id === settings.model)
        ? newModels[0].id
        : settings.model;
    save({ provider: newProvider, model: newModel });
  }
</script>

<div class="no-separators">
<SettingsForm>
  <SettingsFormRow label="Provider">
    <select
      class="field-select"
      value={settings.provider}
      onchange={(e) => handleProviderChange(e.currentTarget.value as AIProvider)}
    >
      {#each Object.entries(PROVIDER_LABELS) as [id, label]}
        <option value={id}>{label}</option>
      {/each}
    </select>
  </SettingsFormRow>

  {#if !apiKeyOptional || apiKey}
    <SettingsFormRow label="API Key{apiKeyOptional ? ' (optional)' : ''}">
      <div class="key-row">
        <Input
          type={showKey ? 'text' : 'password'}
          bind:value={apiKey}
          placeholder={apiKeyOptional ? 'Leave blank for no auth' : 'sk-••••••••••••••••'}
          autocomplete="off"
          onblur={() => save({ apiKey })}
        />
        <Button onclick={() => (showKey = !showKey)}>
          {showKey ? 'Hide' : 'Show'}
        </Button>
      </div>
    </SettingsFormRow>
  {/if}

  <SettingsFormRow label="Model">
    {#if models.length > 0}
      <select
        class="field-select"
        value={settings.model}
        onchange={(e) => save({ model: e.currentTarget.value })}
      >
        {#each models as m}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    {:else}
      <Input
        value={settings.model}
        placeholder="e.g. llama3.2 or custom-model"
        onblur={(e: FocusEvent & { currentTarget: HTMLInputElement }) => save({ model: e.currentTarget.value })}
      />
    {/if}
  </SettingsFormRow>

  {#if needsBaseUrl}
    <SettingsFormRow label="Base URL">
      <Input
        type="url"
        bind:value={baseUrl}
        placeholder={settings.provider === 'ollama'
          ? 'http://localhost:11434'
          : 'https://your-api.example.com'}
        onblur={() => save({ baseUrl: baseUrl || undefined })}
      />
    </SettingsFormRow>
  {/if}

  <SettingsFormRow label="Extension AI Access" separator>
    <Toggle
      checked={settings.allowExtensionUse}
      onchange={() => save({ allowExtensionUse: !settings.allowExtensionUse })}
    />
  </SettingsFormRow>
</SettingsForm>
</div>

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
          oninput={() => save({ temperature })}
        />
      </SettingsFormRow>

      <SettingsFormRow label="Max Tokens">
        <Input
          type="number"
          bind:value={maxTokensStr}
          min="128"
          max="32768"
          step="128"
          onblur={() => save({ maxTokens: parseInt(maxTokensStr) || settings.maxTokens })}
        />
      </SettingsFormRow>

      <SettingsFormRow label="System Prompt">
        <textarea
          class="field-textarea"
          bind:value={systemPrompt}
          rows={4}
          placeholder="You are a helpful assistant."
          onblur={() => save({ systemPrompt: systemPrompt || undefined })}
        ></textarea>
      </SettingsFormRow>
    </SettingsForm>
    </div>
  {/if}
</div>

<style>
  .no-separators :global(.form-row) {
    border-bottom: none;
  }

  .no-separators :global(.form-row.separator) {
    border-top: none;
  }

  .key-row {
    display: flex;
    gap: var(--space-2);
  }

  .key-row :global(.input) {
    flex: 1;
  }

  .advanced-section {
    margin-top: var(--space-4);
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
