<script lang="ts">
  import { onMount } from 'svelte';
  import { Textarea, EmptyState } from '../../components';
  import { agentsManager } from './agentsManager.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import {
    agentsEditorLoad,
    agentsEditorListModels,
    agentsEditorSave,
    agentsListCached,
    agentsForgetCached,
    agentsClearCached,
    agentsPromoteCached,
    type AgentEditorForm,
    type AgentProviderOption,
    type AgentToolGroup,
  } from '../../lib/ipc/commands';
  import { providerRegistry } from '../../services/ai/providerRegistry';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import type { ModelInfo, ProviderId } from '../../services/ai/IProviderPlugin';
  import { extractErrorMessage } from '../../lib/errors';
  import ToolPickerTree from './ToolPickerTree.svelte';
  import Button from '../../components/base/Button.svelte';
  import Input from '../../components/base/Input.svelte';
  import { PlaceholderPicker } from '../../components';
  import { fetchPlaceholders } from '../../lib/placeholders/placeholderResolver';

  const editAgentId = $derived(agentsManager.currentAgentId);

  let form = $state<AgentEditorForm | null>(null);
  let groups = $state<AgentToolGroup[]>([]);
  let providers = $state<AgentProviderOption[]>([]);
  let validationError = $state<string | null>(null);
  let saving = $state(false);

  // Per-provider model cache, scoped to this form mount. Re-fetched on
  // refresh or when switching to a provider whose models aren't cached.
  let modelCache = $state<Record<string, ModelInfo[]>>({});
  let fetchingModels = $state<Record<string, boolean>>({});
  let modelFetchError = $state<Record<string, string | null>>({});

  $effect(() => {
    const agentId = editAgentId;
    const ai = settingsService.getSettings().ai;
    const configs = ai.providers;
    const defaultAgentId = ai.defaultAgentId;
    const providerDescriptors = providerRegistry.list();
    void (async () => {
      try {
        const viewModel = await agentsEditorLoad(
          agentId,
          defaultAgentId,
          providerDescriptors,
          configs,
        );
        form = viewModel.form;
        groups = viewModel.toolGroups;
        providers = viewModel.providers;
      } catch {
        form = null;
        groups = [];
        providers = [];
      }
    })();
  });

  const modelsForProvider = $derived(form?.providerId ? (modelCache[form.providerId] ?? []) : []);
  const isFetchingModels = $derived(form?.providerId ? !!fetchingModels[form.providerId] : false);
  const modelFetchErrorForProvider = $derived(
    form?.providerId ? (modelFetchError[form.providerId] ?? null) : null,
  );

  async function fetchModelsForProvider(providerId: string): Promise<void> {
    if (!form || fetchingModels[providerId]) return;
    const config = settingsService.getSettings().ai.providers[providerId as ProviderId];
    if (!config) return;
    fetchingModels = { ...fetchingModels, [providerId]: true };
    modelFetchError = { ...modelFetchError, [providerId]: null };
    try {
      const { models, selectedModelId } = await agentsEditorListModels(
        providerId,
        config,
        form.modelId,
      );
      modelCache = { ...modelCache, [providerId]: models };
      if (selectedModelId !== form.modelId) form.modelId = selectedModelId;
    } catch (err) {
      modelFetchError = {
        ...modelFetchError,
        [providerId]: err instanceof Error ? err.message : 'Failed to fetch models',
      };
    } finally {
      fetchingModels = { ...fetchingModels, [providerId]: false };
    }
  }

  // Auto-fetch when provider changes and we don't yet have a cached list.
  $effect(() => {
    const pid = form?.providerId;
    if (!pid) return;
    if (modelCache[pid] || fetchingModels[pid]) return;
    void fetchModelsForProvider(pid);
  });

  import { feedbackService } from '../../services/feedback/feedbackService.svelte';

  let cachedItems = $state<[string, string][]>([]);

  async function loadCache() {
    if (editAgentId && form?.silent && form?.cacheResponses) {
      const items = await agentsListCached(editAgentId);
      cachedItems = items || [];
    }
  }

  $effect(() => {
    if (editAgentId && form?.silent && form?.cacheResponses) {
      void loadCache();
    }
  });

  async function promoteItem(input: string) {
    if (!editAgentId) return;
    try {
      await agentsPromoteCached(editAgentId, input);
      await feedbackService.showHUD('✓ Promoted to snippet');
      await loadCache();
    } catch {
      await feedbackService.showHUD('Failed to promote');
    }
  }

  async function deleteItem(input: string) {
    if (!editAgentId) return;
    try {
      await agentsForgetCached(editAgentId, input);
      await loadCache();
    } catch {
      await feedbackService.showHUD('Failed to delete');
    }
  }

  async function clearCache() {
    if (!editAgentId) return;
    try {
      await agentsClearCached(editAgentId);
      await loadCache();
    } catch {
      await feedbackService.showHUD('Failed to clear');
    }
  }

  async function onSave() {
    if (!form) return;
    validationError = null;
    saving = true;
    try {
      await agentsEditorSave(editAgentId, form);
      viewManager.goBack();
    } catch (cause) {
      validationError = extractErrorMessage(cause);
    } finally {
      saving = false;
    }
  }

  function onCancel() {
    viewManager.goBack();
  }

  let tokenList = $state('');

  onMount(async () => {
    const placeholders = await fetchPlaceholders();
    tokenList = placeholders.map((p) => `{${p.token}}`).join(', ');
  });

  let pickerOpen = $state(false);
  let promptTextareaEl = $state<HTMLTextAreaElement | null>(null);

  function openPickerViaButton() {
    pickerOpen = true;
  }

  function closePicker() {
    pickerOpen = false;
    promptTextareaEl?.focus();
  }

  function handleInsert(token: string) {
    if (!form) return;
    const el = promptTextareaEl;
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const t = `{${token}}`;
      form.systemPrompt = form.systemPrompt.slice(0, start) + t + form.systemPrompt.slice(end);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + t.length, start + t.length);
      }, 0);
    } else {
      form.systemPrompt += `{${token}}`;
    }
  }

  function handlePromptInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    if (el.value.endsWith('{')) {
      pickerOpen = true;
    }
  }
</script>

<div class="agent-edit-view">
  <header class="agent-edit-header">
    <h2>{editAgentId ? 'Edit agent' : 'New agent'}</h2>
  </header>

  {#if form}
    {@const activeForm = form}
    <div class="agent-edit-form">
      <div class="form-field">
        <label class="field-label" for="agent-name">Name</label>
        <Input
          textIntent="natural"
          id="agent-name"
          bind:value={activeForm.name}
          placeholder="My Agent"
        />
      </div>

      <div class="form-field">
        <label class="field-label" for="agent-description">Description</label>
        <Input
          textIntent="natural"
          id="agent-description"
          bind:value={activeForm.description}
          placeholder="(optional)"
        />
      </div>

      <div class="form-field" style="position: relative">
        <label class="field-label" for="agent-system-prompt">
          System prompt
          <button
            class="picker-toggle"
            type="button"
            title="Insert placeholder"
            onclick={openPickerViaButton}
            style="margin-left: auto; padding: 2px 6px; font-size: 11px; background: var(--bg-hover); border-radius: var(--radius-xs); border: 1px solid var(--border-color); cursor: pointer;"
            >{'{ }'}</button
          >
        </label>
        <Textarea
          unstyled
          textIntent="natural"
          id="agent-system-prompt"
          class="agent-field-textarea"
          bind:value={activeForm.systemPrompt}
          bind:ref={promptTextareaEl}
          oninput={handlePromptInput}
          rows={6}
          placeholder="You are a helpful assistant."
        ></Textarea>

        {#if pickerOpen}
          <PlaceholderPicker onInsert={handleInsert} onClose={closePicker} />
        {/if}
        <p class="field-hint" style="margin-top: 4px;">
          Type <code
            class="code-inline"
            style="background: var(--bg-hover); padding: 1px 4px; border-radius: var(--radius-xs);"
            >{'{'}</code
          >
          or use placeholders: {tokenList}
        </p>
      </div>

      <div class="form-field">
        <label class="field-label" for="agent-provider">Provider</label>
        {#if providers.length === 0}
          <p class="field-hint">
            No AI providers configured. Add an API key in Settings → AI before creating an agent.
          </p>
        {:else}
          <select id="agent-provider" class="field-select" bind:value={activeForm.providerId}>
            <option value="">Select…</option>
            {#each providers as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        {/if}
      </div>

      <div class="form-field">
        <label class="field-label" for="agent-model">Model</label>
        {#if !activeForm.providerId}
          <p class="field-hint">Pick a provider above to load its models.</p>
        {:else if isFetchingModels}
          <p class="field-hint">Loading models…</p>
        {:else if modelFetchErrorForProvider}
          <p class="field-error">{modelFetchErrorForProvider}</p>
          <Button onclick={() => fetchModelsForProvider(activeForm.providerId)}>Retry</Button>
        {:else if modelsForProvider.length === 0}
          <p class="field-hint">No models returned by this provider.</p>
          <Button onclick={() => fetchModelsForProvider(activeForm.providerId)}>Refresh</Button>
        {:else}
          <div class="model-row">
            <select id="agent-model" class="field-select" bind:value={activeForm.modelId}>
              <option value="">Select…</option>
              {#each modelsForProvider as m (m.id)}
                <option value={m.id}>{m.label}</option>
              {/each}
              {#if activeForm.modelId && !modelsForProvider.some((m) => m.id === activeForm.modelId)}
                <option value={activeForm.modelId}>{activeForm.modelId} (custom)</option>
              {/if}
            </select>
            <Button onclick={() => fetchModelsForProvider(activeForm.providerId)}>Refresh</Button>
          </div>
        {/if}
      </div>

      {#if groups.length > 0}
        <div class="form-field">
          <span class="field-label">Tools</span>
          <ToolPickerTree
            {groups}
            selectedIds={activeForm.toolSelection}
            onChange={(s) => {
              activeForm.toolSelection = s;
            }}
          />
        </div>
      {/if}

      <!--
      Silent AI command settings. When `silent` is off, the agent opens the
      chat view on dispatch (default behavior). When it's on, the agent runs
      headlessly, takes its input from `inputSource`, and applies
      `outputAction` to the LLM's reply. We still persist the choice for
      the two extra fields even when silent is off, so the user doesn't
      lose their picks when toggling.
    -->
      <div class="form-field">
        <label class="silent-toggle">
          <input type="checkbox" bind:checked={activeForm.silent} />
          <span>Run silently (no chat view)</span>
        </label>
        <p class="field-hint silent-hint">
          Silent agents run in the background and put the result back wherever you triggered them
          from. Useful for one-shot tasks like grammar fixes or translations.
        </p>
      </div>

      <div class="form-field" class:disabled={!activeForm.silent}>
        <label class="field-label" for="agent-input-source">Input from</label>
        <select
          id="agent-input-source"
          class="field-select"
          bind:value={activeForm.inputSource}
          disabled={!activeForm.silent}
        >
          <option value="argument">Argument (typed in the launcher bar)</option>
          <option value="selection">Selected text in the active app</option>
          <option value="clipboard">Clipboard contents</option>
          <option value="none">Nothing (use the system prompt alone)</option>
          <option value="shortcodeMiss">Shortcode miss event</option>
        </select>
      </div>

      {#if activeForm.silent && activeForm.inputSource === 'shortcodeMiss'}
        <div class="form-field">
          <label class="field-label" for="agent-shortcode-trigger">Shortcode trigger</label>
          <Input
            textIntent="natural"
            id="agent-shortcode-trigger"
            bind:value={activeForm.shortcodeTrigger}
            placeholder="e.g. : or ;"
          />
          <p class="field-hint">
            The character(s) that must wrap the word to trigger this agent. For example, ":" for
            ":party:" or "/" for "/fix/".
          </p>
        </div>
      {/if}

      <div class="form-field" class:disabled={!activeForm.silent}>
        <label class="field-label" for="agent-output-action">Then</label>
        <select
          id="agent-output-action"
          class="field-select"
          bind:value={activeForm.outputAction}
          disabled={!activeForm.silent}
        >
          <option value="replaceSelection">Replace the selection with the result</option>
          <option value="paste">Paste the result at the cursor</option>
          <option value="copy">Copy the result to the clipboard</option>
          <option value="hud">Show the result as a HUD message</option>
        </select>
      </div>

      {#if activeForm.silent}
        <div class="form-field">
          <label class="silent-toggle">
            <input type="checkbox" bind:checked={activeForm.cacheResponses} />
            <span>Cache and learn responses</span>
          </label>
          <p class="field-hint silent-hint">
            Remembers previous outputs for identical inputs to avoid repeated LLM calls.
          </p>
        </div>

        {#if activeForm.cacheResponses && editAgentId}
          <div class="cache-manager">
            <label class="field-label">Cached Responses ({cachedItems.length})</label>
            {#if cachedItems.length > 0}
              <div class="cache-list custom-scrollbar">
                {#each cachedItems as item}
                  <div class="cache-item">
                    <div class="cache-content">
                      <span class="cache-input" title={item[0]}>{item[0]}</span>
                      <span class="cache-arrow">→</span>
                      <span class="cache-output" title={item[1]}>{item[1]}</span>
                    </div>
                    <div class="cache-actions">
                      <button
                        class="icon-button"
                        onclick={() => promoteItem(item[0])}
                        title="Promote to permanent snippet">✨</button
                      >
                      <button
                        class="icon-button"
                        onclick={() => deleteItem(item[0])}
                        title="Delete cache entry">🗑️</button
                      >
                    </div>
                  </div>
                {/each}
              </div>
              <button class="clear-button" onclick={clearCache}>Clear Cache</button>
            {:else}
              <EmptyState compact message="No responses cached yet" />
            {/if}
          </div>
        {/if}
      {/if}

      {#if validationError}
        <p class="field-error">{validationError}</p>
      {/if}

      <div class="agent-edit-actions">
        <Button onclick={onCancel} disabled={saving}>Cancel</Button>
        <Button onclick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .agent-edit-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .agent-edit-header h2 {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .agent-edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-secondary);
  }

  :global(.agent-field-textarea) {
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: inherit;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--transition-smooth);
  }

  :global(.agent-field-textarea):focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .field-select {
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

  .field-error {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    margin: 0;
  }

  .field-hint {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin: 0;
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
  }

  .model-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .model-row .field-select {
    flex: 1;
  }

  .agent-edit-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .silent-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    cursor: pointer;
  }

  .silent-hint {
    margin-top: var(--space-1);
  }

  .form-field.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .field-select:disabled {
    cursor: not-allowed;
  }

  .cache-manager {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }

  .cache-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 150px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
  }

  .cache-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2);
    border-bottom: 1px solid var(--border-color);
  }

  .cache-item:last-child {
    border-bottom: none;
  }

  .cache-content {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    overflow: hidden;
    font-family: monospace;
    font-size: var(--font-size-xs);
  }

  .cache-input {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .cache-arrow {
    color: var(--text-secondary);
  }

  .cache-output {
    color: var(--accent-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .cache-actions {
    display: flex;
    gap: var(--space-1);
  }

  .icon-button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--font-size-sm);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
  }

  .icon-button:hover {
    background: var(--bg-secondary);
  }

  .clear-button {
    align-self: flex-end;
    background: none;
    border: 1px solid var(--accent-danger);
    color: var(--accent-danger);
    font-size: var(--font-size-xs);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .clear-button:hover {
    background: var(--accent-danger-fill);
    color: var(--text-on-accent);
  }
</style>
