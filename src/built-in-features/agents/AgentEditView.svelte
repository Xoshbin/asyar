<script lang="ts">
  import { agentService } from './agentService.svelte';
  import { agentsManager } from './agentsManager.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { agentsToolsList } from '../../lib/ipc/commands';
  import { listProviders, getProvider } from '../../services/ai/providerRegistry';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import {
    buildInitialFormState,
    validateForm,
    handleSave,
    groupDescriptorsBySource,
    toggleToolSelection,
    filterAvailableProviders,
    selectInitialModelId,
    type EditFormState,
  } from './agentEditView.helpers';
  import type { ToolDescriptor } from 'asyar-sdk/contracts';
  import type { ModelInfo, ProviderId } from '../../services/ai/IProviderPlugin';
  import ToolPickerTree from './ToolPickerTree.svelte';
  import Button from '../../components/base/Button.svelte';
  import Input from '../../components/base/Input.svelte';

  const editAgentId = $derived(agentsManager.currentAgentId);
  const initialAgent = $derived(editAgentId ? (agentService.getById(editAgentId) ?? null) : null);

  let form = $state<EditFormState>(buildInitialFormState(null));
  let descLocal = $state('');
  let descriptors = $state<ToolDescriptor[]>([]);
  let validationError = $state<string | null>(null);
  let saving = $state(false);

  // Per-provider model cache, scoped to this form mount. Re-fetched on
  // refresh or when switching to a provider whose models aren't cached.
  let modelCache = $state<Record<string, ModelInfo[]>>({});
  let fetchingModels = $state<Record<string, boolean>>({});
  let modelFetchError = $state<Record<string, string | null>>({});

  $effect(() => {
    const built = buildInitialFormState(initialAgent);
    form = built;
    descLocal = built.description ?? '';
  });

  $effect(() => {
    form.description = descLocal === '' ? null : descLocal;
  });

  $effect(() => {
    void (async () => {
      try {
        descriptors = await agentsToolsList();
      } catch {
        descriptors = [];
      }
    })();
  });

  const groups = $derived(groupDescriptorsBySource(descriptors));
  const providers = $derived(
    filterAvailableProviders(listProviders(), settingsService.getSettings().ai.providers),
  );
  const modelsForProvider = $derived(form.providerId ? (modelCache[form.providerId] ?? []) : []);
  const isFetchingModels = $derived(form.providerId ? !!fetchingModels[form.providerId] : false);
  const modelFetchErrorForProvider = $derived(
    form.providerId ? (modelFetchError[form.providerId] ?? null) : null,
  );

  async function fetchModelsForProvider(providerId: string): Promise<void> {
    if (fetchingModels[providerId]) return;
    const plugin = getProvider(providerId as ProviderId);
    const config = settingsService.getSettings().ai.providers[providerId as ProviderId];
    if (!plugin || !config) return;
    fetchingModels = { ...fetchingModels, [providerId]: true };
    modelFetchError = { ...modelFetchError, [providerId]: null };
    try {
      const models = await plugin.getModels(config);
      modelCache = { ...modelCache, [providerId]: models };
      // After fetch lands, default the modelId if it's still empty.
      const last = config.lastModelId ?? '';
      const next = selectInitialModelId(form.modelId, last, models);
      if (next !== form.modelId) form.modelId = next;
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
    const pid = form.providerId;
    if (!pid) return;
    if (modelCache[pid] || fetchingModels[pid]) return;
    void fetchModelsForProvider(pid);
  });

  async function onSave() {
    const result = validateForm(form);
    if (!result.ok) {
      validationError = result.error;
      return;
    }
    validationError = null;
    saving = true;
    try {
      await handleSave(form, {
        agentId: editAgentId ?? undefined,
        deps: { service: agentService, manager: agentsManager, viewManager },
      });
    } finally {
      saving = false;
    }
  }

  function onCancel() {
    viewManager.goBack();
  }
</script>

<div class="agent-edit-view">
  <header class="agent-edit-header">
    <h2>{editAgentId ? 'Edit agent' : 'New agent'}</h2>
  </header>

  <div class="agent-edit-form">
    <div class="form-field">
      <label class="field-label" for="agent-name">Name</label>
      <Input id="agent-name" bind:value={form.name} placeholder="My Agent" />
    </div>

    <div class="form-field">
      <label class="field-label" for="agent-description">Description</label>
      <Input id="agent-description" bind:value={descLocal} placeholder="(optional)" />
    </div>

    <div class="form-field">
      <label class="field-label" for="agent-system-prompt">System prompt</label>
      <textarea
        id="agent-system-prompt"
        class="field-textarea"
        bind:value={form.systemPrompt}
        rows={6}
        placeholder="You are a helpful assistant."
      ></textarea>
    </div>

    <div class="form-field">
      <label class="field-label" for="agent-provider">Provider</label>
      {#if providers.length === 0}
        <p class="field-hint">
          No AI providers configured. Add an API key in Settings → AI before creating an agent.
        </p>
      {:else}
        <select id="agent-provider" class="field-select" bind:value={form.providerId}>
          <option value="">Select…</option>
          {#each providers as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="form-field">
      <label class="field-label" for="agent-model">Model</label>
      {#if !form.providerId}
        <p class="field-hint">Pick a provider above to load its models.</p>
      {:else if isFetchingModels}
        <p class="field-hint">Loading models…</p>
      {:else if modelFetchErrorForProvider}
        <p class="field-error">{modelFetchErrorForProvider}</p>
        <Button onclick={() => fetchModelsForProvider(form.providerId)}>Retry</Button>
      {:else if modelsForProvider.length === 0}
        <p class="field-hint">No models returned by this provider.</p>
        <Button onclick={() => fetchModelsForProvider(form.providerId)}>Refresh</Button>
      {:else}
        <div class="model-row">
          <select id="agent-model" class="field-select" bind:value={form.modelId}>
            <option value="">Select…</option>
            {#each modelsForProvider as m (m.id)}
              <option value={m.id}>{m.label}</option>
            {/each}
            {#if form.modelId && !modelsForProvider.some((m) => m.id === form.modelId)}
              <option value={form.modelId}>{form.modelId} (custom)</option>
            {/if}
          </select>
          <Button onclick={() => fetchModelsForProvider(form.providerId)}>Refresh</Button>
        </div>
      {/if}
    </div>

    {#if groups.length > 0}
      <div class="form-field">
        <span class="field-label">Tools</span>
        <ToolPickerTree
          {groups}
          selectedIds={form.toolSelection}
          onChange={(s) => { form.toolSelection = s; }}
        />
      </div>
    {/if}

    {#if validationError}
      <p class="field-error">{validationError}</p>
    {/if}

    <div class="agent-edit-actions">
      <Button onclick={onCancel} disabled={saving}>Cancel</Button>
      <Button onclick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
    </div>
  </div>
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

  .field-textarea {
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

  .field-textarea:focus {
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
    color: var(--color-error, #ef4444);
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
</style>
