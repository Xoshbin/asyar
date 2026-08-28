<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../services/i18n';
  import type { ModelInfo } from '../../services/ai/IProviderPlugin';

  type ListItem = { type: 'model'; model: ModelInfo } | { type: 'custom'; modelId: string };

  let {
    id,
    models = [],
    value = $bindable(''),
    placeholder,
    disabled = false,
    allowCustom = true,
    onchange,
  }: {
    id?: string;
    models?: ModelInfo[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    allowCustom?: boolean;
    onchange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let searchQuery = $state('');
  let highlightedIndex = $state(0);

  let containerRef = $state<HTMLDivElement | null>(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let searchInputRef = $state<HTMLInputElement | null>(null);
  let listRef = $state<HTMLUListElement | null>(null);

  const defaultPlaceholder = $derived(placeholder ?? t('settings.ai.select_model'));
  const selectedModel = $derived(models.find((m) => m.id === value));
  const isCustomSelection = $derived(!selectedModel && !!value);
  const displayLabel = $derived(
    selectedModel
      ? selectedModel.label
      : value
        ? `${value} (${t('settings.ai.custom_model_badge') || 'custom'})`
        : defaultPlaceholder,
  );

  const normalizedQuery = $derived(searchQuery.trim().toLowerCase());
  const filteredModels = $derived(
    normalizedQuery === ''
      ? models
      : models.filter(
          (m) =>
            m.label.toLowerCase().includes(normalizedQuery) ||
            m.id.toLowerCase().includes(normalizedQuery),
        ),
  );

  const showCustomAction = $derived(
    allowCustom &&
      normalizedQuery !== '' &&
      !models.some((m) => m.id.toLowerCase() === normalizedQuery),
  );

  const listItems = $derived<ListItem[]>([
    ...filteredModels.map((m) => ({ type: 'model' as const, model: m })),
    ...(showCustomAction ? [{ type: 'custom' as const, modelId: searchQuery.trim() }] : []),
  ]);

  $effect(() => {
    const len = listItems.length;
    if (len === 0) {
      highlightedIndex = 0;
      return;
    }
    if (highlightedIndex >= len) {
      highlightedIndex = len - 1;
    } else if (highlightedIndex < 0) {
      highlightedIndex = 0;
    }
  });

  export async function openPopover(): Promise<void> {
    if (disabled || open) return;
    searchQuery = '';
    open = true;
    const currentIdx = listItems.findIndex(
      (item) => item.type === 'model' && item.model.id === value,
    );
    highlightedIndex = currentIdx >= 0 ? currentIdx : 0;
    await tick();
    searchInputRef?.focus();
    scrollHighlightedIntoView();
  }

  export function closePopover(): void {
    if (!open) return;
    open = false;
    searchQuery = '';
  }

  export function togglePopover(): void {
    if (open) {
      closePopover();
      triggerRef?.focus();
    } else {
      void openPopover();
    }
  }

  function scrollHighlightedIntoView(): void {
    if (!listRef) return;
    const highlightedEl = listRef.children[highlightedIndex] as HTMLElement | undefined;
    if (typeof highlightedEl?.scrollIntoView === 'function') {
      highlightedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectItem(item: ListItem): void {
    const selectedId = item.type === 'model' ? item.model.id : item.modelId;
    value = selectedId;
    onchange?.(selectedId);
    closePopover();
    triggerRef?.focus();
  }

  function handleTriggerKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void openPopover();
    }
  }

  function handlePopoverKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (listItems.length > 0) {
        highlightedIndex = (highlightedIndex + 1) % listItems.length;
        scrollHighlightedIntoView();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (listItems.length > 0) {
        highlightedIndex = (highlightedIndex - 1 + listItems.length) % listItems.length;
        scrollHighlightedIntoView();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const item = listItems[highlightedIndex];
      if (item) {
        selectItem(item);
      } else if (allowCustom && searchQuery.trim()) {
        selectItem({ type: 'custom', modelId: searchQuery.trim() });
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (searchQuery) {
        searchQuery = '';
      } else {
        closePopover();
        triggerRef?.focus();
      }
    } else if (e.key === 'Tab') {
      closePopover();
    }
  }

  function handleWindowClick(e: MouseEvent): void {
    if (!open) return;
    const target = e.target as Node | null;
    if (
      containerRef &&
      !containerRef.contains(target) &&
      popoverRef &&
      !popoverRef.contains(target)
    ) {
      closePopover();
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="model-selector" bind:this={containerRef}>
  <button
    {id}
    type="button"
    class="ms-trigger"
    class:is-custom={isCustomSelection}
    class:is-empty={!value}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    bind:this={triggerRef}
    onclick={togglePopover}
    onkeydown={handleTriggerKeydown}
  >
    <span class="ms-trigger-label">
      {displayLabel}
    </span>
    <span class="ms-trigger-icons">
      {#if isCustomSelection}
        <span class="ms-custom-badge">{t('settings.ai.custom_model_badge') || 'custom'}</span>
      {/if}
      <svg class="ms-caret-icon" viewBox="0 0 10 6" fill="none" aria-hidden="true">
        <path
          d="M1 1l4 4 4-4"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="ms-popover"
      bind:this={popoverRef}
      onkeydown={handlePopoverKeydown}
      role="region"
      aria-label="Model selector popover"
    >
      <div class="ms-search-bar">
        <svg class="ms-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" />
          <path
            d="M10.5 10.5L14 14"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <input
          type="text"
          class="ms-search-input"
          bind:this={searchInputRef}
          bind:value={searchQuery}
          placeholder={t('settings.ai.filter_models') || 'Filter models…'}
          aria-label={t('settings.ai.filter_models') || 'Filter models…'}
        />
        {#if searchQuery}
          <button
            type="button"
            class="ms-clear-btn"
            aria-label="Clear search"
            onclick={() => {
              searchQuery = '';
              searchInputRef?.focus();
            }}
          >
            ×
          </button>
        {/if}
      </div>

      <ul class="ms-options-list custom-scrollbar" role="listbox" bind:this={listRef}>
        {#if listItems.length === 0}
          <li class="ms-empty-message">
            {searchQuery
              ? t('settings.ai.no_models_matching', { query: searchQuery }) ||
                `No models matching "${searchQuery}"`
              : t('settings.ai.no_models_available') || 'No models available'}
          </li>
        {:else}
          {#each listItems as item, idx (item.type === 'model' ? item.model.id : `custom-${item.modelId}`)}
            {@const isHighlighted = idx === highlightedIndex}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            {#if item.type === 'model'}
              {@const isSelected = item.model.id === value}
              <li
                class="ms-option-item"
                class:highlighted={isHighlighted}
                class:selected={isSelected}
                role="option"
                aria-selected={isSelected}
                onclick={() => selectItem(item)}
                onmouseenter={() => {
                  highlightedIndex = idx;
                }}
              >
                <div class="ms-option-details">
                  <span class="ms-option-label">{item.model.label}</span>
                  {#if item.model.id !== item.model.label}
                    <span class="ms-option-id">{item.model.id}</span>
                  {/if}
                </div>
                {#if isSelected}
                  <svg class="ms-check-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3.5 8.5L6.5 11.5L12.5 4.5"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                {/if}
              </li>
            {:else if item.type === 'custom'}
              <li
                class="ms-option-item ms-custom-action"
                class:highlighted={isHighlighted}
                role="option"
                aria-selected={false}
                onclick={() => selectItem(item)}
                onmouseenter={() => {
                  highlightedIndex = idx;
                }}
              >
                <div class="ms-option-details">
                  <span class="ms-option-label ms-custom-prompt">
                    {t('settings.ai.use_custom_model', { query: item.modelId }) ||
                      `Use custom model "${item.modelId}"`}
                  </span>
                  <span class="ms-option-id">{item.modelId}</span>
                </div>
                <span class="ms-custom-badge"
                  >{t('settings.ai.custom_model_badge') || 'custom'}</span
                >
              </li>
            {/if}
          {/each}
        {/if}
      </ul>
    </div>
  {/if}
</div>

<style>
  .model-selector {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  .ms-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    line-height: 1.4;
    cursor: pointer;
    text-align: left;
    box-sizing: border-box;
    transition:
      border-color var(--transition-fast),
      box-shadow var(--transition-fast);
  }

  .ms-trigger:focus-visible {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
    outline: none;
  }

  .ms-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ms-trigger.is-empty .ms-trigger-label {
    color: var(--text-tertiary);
  }

  .ms-trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .ms-trigger-icons {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: var(--space-2);
    flex-shrink: 0;
  }

  .ms-caret-icon {
    width: 10px;
    height: 6px;
    color: var(--text-secondary);
  }

  .ms-popover {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: var(--z-dropdown);
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popup);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .ms-search-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border-bottom: 1px solid var(--separator);
    box-sizing: border-box;
  }

  .ms-search-icon {
    width: var(--size-sm);
    height: var(--size-sm);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .ms-search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    padding: var(--space-1) 0;
    line-height: 1.4;
    box-sizing: border-box;
  }

  .ms-search-input::placeholder {
    color: var(--text-tertiary);
  }

  .ms-clear-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: var(--font-size-md);
    line-height: 1;
    cursor: pointer;
    padding: var(--space-0-5);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--transition-fast);
  }

  .ms-clear-btn:hover {
    color: var(--text-primary);
  }

  .ms-options-list {
    list-style: none;
    margin: 0;
    padding: var(--space-1) 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .ms-option-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    gap: var(--space-2);
    color: var(--text-primary);
    transition: background var(--dur-instant) var(--ease-travel);
  }

  .ms-option-item:hover,
  .ms-option-item.highlighted {
    background: var(--bg-hover);
  }

  .ms-option-item.selected {
    background: var(--bg-selected);
  }

  .ms-option-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    flex: 1;
  }

  .ms-option-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-option-id {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-check-icon {
    width: var(--size-sm);
    height: var(--size-sm);
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .ms-custom-action {
    background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
  }

  .ms-custom-action:hover,
  .ms-custom-action.highlighted {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  .ms-custom-prompt {
    color: var(--accent-primary);
  }

  .ms-custom-badge {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-1);
    line-height: 1;
    flex-shrink: 0;
  }

  .ms-empty-message {
    padding: var(--space-4) var(--space-3);
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  }
</style>
