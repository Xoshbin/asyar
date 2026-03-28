<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { aiSettings, updateAISettings, PROVIDER_MODELS, type AIProvider } from './aiStore';

  const dispatch = createEventDispatcher();

  // Local editable copy
  let provider: AIProvider = $aiSettings.provider;
  let apiKey = $aiSettings.apiKey;
  let model = $aiSettings.model;
  let baseUrl = $aiSettings.baseUrl ?? '';
  let systemPrompt = $aiSettings.systemPrompt ?? '';
  let temperature = $aiSettings.temperature;
  let maxTokens = $aiSettings.maxTokens;
  let showAdvanced = false;
  let showKey = false;
  let saved = false;

  const PROVIDER_LABELS: Record<AIProvider, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Gemini',
    ollama: 'Ollama (local)',
    openrouter: 'OpenRouter',
    custom: 'Custom (OpenAI-compatible)',
  };

  $: models = PROVIDER_MODELS[provider];
  $: if (models.length > 0 && !models.find(m => m.id === model)) {
    model = models[0].id;
  }
  $: needsBaseUrl = provider === 'ollama' || provider === 'custom';
  $: apiKeyOptional = provider === 'ollama';

  function save() {
    updateAISettings({ provider, apiKey, model, baseUrl: needsBaseUrl ? baseUrl : undefined, systemPrompt: systemPrompt || undefined, temperature, maxTokens });
    saved = true;
    setTimeout(() => { saved = false; }, 2000);
  }
</script>

<div class="settings-view">
  <div class="settings-header">
    <button class="back-btn" on:click={() => dispatch('close')} title="Back to chat">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
    </button>
    <span class="settings-title">⚙️ AI Settings</span>
  </div>

  <div class="settings-body">
    <!-- Provider -->
    <div class="field">
      <label class="field-label" for="ai-provider">Provider</label>
      <select id="ai-provider" class="field-select" bind:value={provider}>
        {#each Object.entries(PROVIDER_LABELS) as [id, label]}
          <option value={id}>{label}</option>
        {/each}
      </select>
    </div>

    <!-- API Key (hidden for Ollama) -->
    {#if !apiKeyOptional || apiKey}
      <div class="field">
        <label class="field-label" for="ai-key">
          API Key {apiKeyOptional ? '(optional)' : ''}
        </label>
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
          <button class="eye-btn" on:click={() => showKey = !showKey} title={showKey ? 'Hide' : 'Show'}>
            {#if showKey}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <!-- Model -->
    <div class="field">
      <label class="field-label" for="ai-model">Model</label>
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
    </div>

    <!-- Base URL (Ollama / Custom only) -->
    {#if needsBaseUrl}
      <div class="field">
        <label class="field-label" for="ai-url">Base URL</label>
        <input
          id="ai-url"
          class="field-input"
          type="url"
          bind:value={baseUrl}
          placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://your-api.example.com'}
        />
      </div>
    {/if}

    <!-- Advanced toggle -->
    <button class="advanced-toggle" on:click={() => showAdvanced = !showAdvanced}>
      {showAdvanced ? '▾' : '▸'} Advanced
    </button>

    {#if showAdvanced}
      <div class="advanced-section">
        <div class="field">
          <label class="field-label" for="ai-temp">Temperature <span class="field-value">{temperature}</span></label>
          <input id="ai-temp" class="field-range" type="range" min="0" max="2" step="0.05" bind:value={temperature} />
        </div>
        <div class="field">
          <label class="field-label" for="ai-tokens">Max Tokens</label>
          <input id="ai-tokens" class="field-input" type="number" bind:value={maxTokens} min="128" max="32768" step="128" />
        </div>
        <div class="field">
          <label class="field-label" for="ai-system">System Prompt</label>
          <textarea
            id="ai-system"
            class="field-textarea"
            bind:value={systemPrompt}
            rows="4"
            placeholder="You are a helpful assistant."
          ></textarea>
        </div>
      </div>
    {/if}

    <div class="save-row">
      <button class="save-btn" class:saved on:click={save}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--system-font, system-ui);
  }
  .settings-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    background: var(--bg-secondary);
  }
  .back-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    padding: 3px 6px;
    border-radius: 5px;
    transition: all 0.12s;
  }
  .back-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .settings-title { font-size: 13px; font-weight: 600; }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .settings-body::-webkit-scrollbar { width: 6px; }
  .settings-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 4px; }

  .field { display: flex; flex-direction: column; gap: 5px; }
  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .field-value { font-weight: 400; color: var(--accent-primary); margin-left: 4px; }
  .field-input, .field-select, .field-textarea {
    padding: 7px 10px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.12s;
  }
  .field-input:focus, .field-select:focus, .field-textarea:focus {
    border-color: var(--accent-primary);
  }
  .field-select { appearance: auto; cursor: pointer; }
  .field-textarea { resize: vertical; min-height: 70px; }
  .field-range {
    width: 100%;
    accent-color: var(--accent-primary);
  }
  .key-row { display: flex; gap: 6px; }
  .key-row .field-input { flex: 1; }
  .eye-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 7px;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0 10px;
    display: flex;
    align-items: center;
    transition: all 0.12s;
  }
  .eye-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .advanced-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 12px;
    padding: 2px 0;
    text-align: left;
    transition: color 0.12s;
  }
  .advanced-toggle:hover { color: var(--text-primary); }
  .advanced-section { display: flex; flex-direction: column; gap: 12px; }

  .save-row { margin-top: 4px; }
  .save-btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    background: var(--accent-primary);
    color: white;
    transition: all 0.15s;
    width: 100%;
  }
  .save-btn:hover { filter: brightness(1.1); }
  .save-btn.saved { background: var(--accent-success, #28cd41); }
</style>
