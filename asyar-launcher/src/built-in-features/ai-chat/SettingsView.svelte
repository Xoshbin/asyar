<script lang="ts">
  import { aiStore, PROVIDER_MODELS, type AIProvider } from './aiStore.svelte';
  import { FormField } from '../../components';

  let { onclose } = $props();

  // Local editable copy
  let provider = $state<AIProvider>(aiStore.settings.provider);
  let apiKey = $state(aiStore.settings.apiKey);
  let model = $state(aiStore.settings.model);
  let baseUrl = $state(aiStore.settings.baseUrl ?? '');
  let systemPrompt = $state(aiStore.settings.systemPrompt ?? '');
  let temperature = $state(aiStore.settings.temperature);
  let maxTokens = $state(aiStore.settings.maxTokens);
  let showAdvanced = $state(false);
  let showKey = $state(false);
  let saved = $state(false);

  const PROVIDER_LABELS: Record<AIProvider, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Gemini',
    ollama: 'Ollama (local)',
    openrouter: 'OpenRouter',
    custom: 'Custom (OpenAI-compatible)',
  };

  let models = $derived(PROVIDER_MODELS[provider]);
  $effect(() => {
    if (models.length > 0 && !models.find(m => m.id === model)) {
      model = models[0].id;
    }
  });
  let needsBaseUrl = $derived(provider === 'ollama' || provider === 'custom');
  let apiKeyOptional = $derived(provider === 'ollama');

  function save() {
    aiStore.updateAISettings({ provider, apiKey, model, baseUrl: needsBaseUrl ? baseUrl : undefined, systemPrompt: systemPrompt || undefined, temperature, maxTokens });
    saved = true;
    setTimeout(() => { saved = false; }, 2000);
  }
</script>

<div class="view-container">

  <div class="settings-body custom-scrollbar">
    <!-- Provider -->
    <FormField label="Provider" id="ai-provider">
      <select id="ai-provider" class="field-select" bind:value={provider}>
        {#each Object.entries(PROVIDER_LABELS) as [id, label]}
          <option value={id}>{label}</option>
        {/each}
      </select>
    </FormField>

    <!-- API Key (hidden for Ollama) -->
    {#if !apiKeyOptional || apiKey}
      <FormField label="API Key {apiKeyOptional ? '(optional)' : ''}" id="ai-key">
        <div class="key-row">
          <input
            id="ai-key"
            class="field-input"
            type={showKey ? 'text' : 'password'}
            bind:value={apiKey}
            placeholder={apiKeyOptional ? 'Leave blank for no auth' : 'sk-••••••••••••••••'}
            autocomplete="off"
            spellcheck="false"
          />
          <button class="eye-btn" onclick={() => showKey = !showKey} title={showKey ? 'Hide' : 'Show'}>
            {#if showKey}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {/if}
          </button>
        </div>
      </FormField>
    {/if}

    <!-- Model -->
    <FormField label="Model" id="ai-model">
      {#if models.length > 0}
        <select id="ai-model" class="field-select" bind:value={model}>
          {#each models as m}
            <option value={m.id}>{m.label}</option>
          {/each}
        </select>
      {:else}
        <!-- Ollama / Custom: free-form model name -->
        <input id="ai-model" class="field-input" type="text" bind:value={model} placeholder="e.g. llama3.2 or custom-model" />
      {/if}
    </FormField>

    <!-- Base URL (Ollama / Custom only) -->
    {#if needsBaseUrl}
      <FormField label="Base URL" id="ai-url">
        <input
          id="ai-url"
          class="field-input"
          type="url"
          bind:value={baseUrl}
          placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://your-api.example.com'}
        />
      </FormField>
    {/if}

    <FormField label="Extension AI Access" id="ai-extensions">
      <input
        id="ai-extensions"
        type="checkbox"
        checked={aiStore.settings.allowExtensionUse}
        onchange={(e) => { aiStore.settings.allowExtensionUse = e.currentTarget.checked; }}
      />
    </FormField>

    <!-- Advanced toggle -->
    <button class="text-label advanced-toggle" onclick={() => showAdvanced = !showAdvanced}>
      {showAdvanced ? '▾' : '▸'} Advanced
    </button>

    {#if showAdvanced}
      <div class="advanced-section">
        <FormField label="Temperature {temperature}" id="ai-temp">
          <input id="ai-temp" class="field-range" type="range" min="0" max="2" step="0.05" bind:value={temperature} />
        </FormField>
        <FormField label="Max Tokens" id="ai-tokens">
          <input id="ai-tokens" class="field-input" type="number" bind:value={maxTokens} min="128" max="32768" step="128" />
        </FormField>
        <FormField label="System Prompt" id="ai-system">
          <textarea
            id="ai-system"
            class="field-textarea"
            bind:value={systemPrompt}
            rows="4"
            placeholder="You are a helpful assistant."
          ></textarea>
        </FormField>
      </div>
    {/if}

    <div class="save-row">
      <button class="btn-primary save-btn" class:saved onclick={save}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  </div>
</div>

<style>

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }



  .key-row { display: flex; gap: 6px; }
  .key-row .field-input { flex: 1; }
  .eye-btn {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0 10px;
    display: flex;
    align-items: center;
    transition: all var(--transition-fast);
  }
  .eye-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .advanced-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 0;
    text-align: left;
    transition: color var(--transition-fast);
  }
  .advanced-toggle:hover { color: var(--text-primary); }
  .advanced-section { display: flex; flex-direction: column; gap: 12px; }

  .save-row { margin-top: 4px; }
  .save-btn {
    width: 100%;
  }
  .save-btn.saved { background: var(--accent-success); }
</style>
