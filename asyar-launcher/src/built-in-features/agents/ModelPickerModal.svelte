<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Modal from '../../components/base/Modal.svelte';
  import Input from '../../components/base/Input.svelte';
  import { agentsManager } from './agentsManager.svelte';
  import { agentService } from './agentService.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { providerRegistry } from '../../services/ai/providerRegistry';
  import { providerLabel, threadRunTarget } from './agentChatView.helpers';
  import {
    modelCatalog,
    providerOptions,
    modelOptions,
    filterOptions,
    modelForProvider,
    type PickerOption,
  } from './modelCatalog.svelte';
  import { setActiveThreadModel } from './threadProvider';
  import { t } from '../../services/i18n';

  let query = $state('');
  let highlighted = $state(0);
  // Set when Change Provider hands off to a provider with no saved model:
  // the model list then shows that provider instead of the thread's.
  let pendingProviderId = $state<string | null>(null);
  let inputRef = $state<HTMLInputElement | null>(null);
  let listRef = $state<HTMLUListElement | null>(null);

  const mode = $derived(agentsManager.picker);
  const providers = $derived(settingsService.currentSettings.ai.providers);

  const agent = $derived.by(() => {
    const agentId = agentsManager.currentAgentId;
    return agentId ? (agentService.getById(agentId) ?? null) : null;
  });

  // What the active thread runs on now: its own choice, else its agent's.
  const current = $derived.by(() => {
    void agentsManager.threadsVersion; // the known-threads map is not reactive
    if (!agent) return null;
    const thread = agentsManager
      .threadsFor(agent.id)
      ?.find((th) => th.id === agentsManager.currentThreadId);
    return threadRunTarget(agent, thread);
  });

  // The provider whose models Change Model lists.
  const modelProviderId = $derived(pendingProviderId ?? current?.providerId ?? null);

  const options = $derived.by((): PickerOption[] => {
    if (mode === 'provider') return providerOptions(providers, providerRegistry.list());
    if (mode === 'model' && modelProviderId) {
      const inUse = current?.providerId === modelProviderId ? current.modelId : null;
      return modelOptions(modelCatalog.models[modelProviderId] ?? [], inUse);
    }
    return [];
  });
  const rows = $derived(filterOptions(options, query));

  const selectedId = $derived(
    mode === 'provider'
      ? (current?.providerId ?? null)
      : current?.providerId === modelProviderId
        ? (current?.modelId ?? null)
        : null,
  );

  const title = $derived(
    mode === 'provider'
      ? t('features.agents.model_picker.title_provider')
      : t('features.agents.model_picker.title_model', {
          provider: modelProviderId
            ? providerLabel(modelProviderId, providers, providerRegistry.list())
            : '',
        }),
  );
  const placeholder = $derived(
    mode === 'provider'
      ? t('features.agents.model_picker.filter_providers')
      : t('features.agents.model_picker.filter_models'),
  );
  const loading = $derived(
    mode === 'model' && !!modelProviderId && !!modelCatalog.loading[modelProviderId],
  );
  const loadError = $derived(
    mode === 'model' && modelProviderId ? (modelCatalog.errors[modelProviderId] ?? null) : null,
  );

  // On every open or mode switch: clear the query and load the listed
  // provider's models. Untracked: loading reads catalog state, and tracking
  // it would re-run this (and wipe the query) the moment the list lands.
  $effect(() => {
    if (!mode) {
      pendingProviderId = null;
      return;
    }
    const providerId = modelProviderId;
    untrack(() => {
      query = '';
      if (mode === 'model' && providerId) void modelCatalog.load(providerId, providers[providerId]);
    });
    void tick().then(() => inputRef?.focus());
  });

  // Start on the item in use, also once a model list arrives. Typing moves
  // the highlight back to the top match.
  $effect(() => {
    const list = options;
    const selected = selectedId;
    if (untrack(() => query) !== '') return;
    highlighted = Math.max(
      0,
      list.findIndex((o) => o.id === selected),
    );
  });
  $effect(() => {
    if (query !== '') highlighted = 0;
  });

  function scrollHighlightedIntoView() {
    const row = listRef?.querySelector<HTMLElement>(`[data-row="${highlighted}"]`);
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    agentsManager.picker = null;
  }

  function pick(option: PickerOption) {
    if (mode === 'provider') {
      const modelId = agent ? modelForProvider(option.id, providers, agent) : null;
      if (!modelId) {
        // No model known for this provider yet: let the user choose one.
        pendingProviderId = option.id;
        agentsManager.picker = 'model';
        return;
      }
      close();
      void setActiveThreadModel({ providerId: option.id, modelId });
    } else if (modelProviderId) {
      close();
      void setActiveThreadModel({ providerId: modelProviderId, modelId: option.id });
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted = (highlighted + step + rows.length) % rows.length;
      void tick().then(scrollHighlightedIntoView);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = rows[highlighted];
      if (option) pick(option);
    }
  }
</script>

<Modal
  bind:isOpen={() => agentsManager.picker !== null, (open) => !open && close()}
  {title}
  width="28rem"
>
  <Input
    textIntent="exact"
    bind:ref={inputRef}
    bind:value={query}
    type="text"
    {placeholder}
    aria-label={placeholder}
    aria-autocomplete="list"
    autocomplete="off"
    onkeydown={onKeydown}
  />

  {#if rows.length > 0}
    <ul class="picker-list custom-scrollbar" role="listbox" bind:this={listRef}>
      {#each rows as option, index (option.id)}
        <li
          class="picker-row"
          class:highlighted={index === highlighted}
          data-row={index}
          role="option"
          aria-selected={option.id === selectedId}
          onclick={() => pick(option)}
          onkeydown={onKeydown}
          onmouseenter={() => (highlighted = index)}
        >
          <span class="picker-check" aria-hidden="true">
            {#if option.id === selectedId}
              <svg
                viewBox="0 0 10 8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M1 4L3.8 7L9 1" />
              </svg>
            {/if}
          </span>
          <span class="picker-label">{option.label}</span>
        </li>
      {/each}
    </ul>
  {:else if loading}
    <p class="picker-status">{t('features.agents.model_picker.loading')}</p>
  {:else if !loadError}
    <p class="picker-status">
      {mode === 'provider'
        ? t('features.agents.model_picker.no_providers')
        : t('features.agents.model_picker.no_models')}
    </p>
  {/if}

  {#if loading && rows.length > 0}
    <p class="picker-status">{t('features.agents.model_picker.loading')}</p>
  {/if}
  {#if loadError}
    <p class="picker-status picker-error">
      {t('features.agents.model_picker.load_error', { error: loadError })}
    </p>
  {/if}
</Modal>

<style>
  .picker-list {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    max-height: 22rem;
    overflow-y: auto;
  }
  .picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }
  .picker-row.highlighted {
    background: var(--bg-hover);
  }
  .picker-check {
    width: var(--size-xs);
    height: var(--size-xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--accent-primary);
  }
  .picker-check svg {
    width: var(--space-4);
    height: var(--space-3);
  }
  .picker-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .picker-status {
    margin: var(--space-3) 0 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
  .picker-error {
    color: var(--accent-danger);
  }
</style>
