<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Input from '../base/Input.svelte';
  import EmptyState from '../feedback/EmptyState.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { t } from '../../services/i18n';

  export interface SelectOption {
    value: string;
    label: string;
  }

  let {
    id,
    value = $bindable(''),
    options = [] as SelectOption[],
    placeholder = t('features.agents.edit.select'),
    filterPlaceholder = t('search_accessory.filter_placeholder'),
    disabled = false,
    searchable = true,
    autofocus = false,
    onchange,
  }: {
    id?: string;
    value?: string;
    options?: SelectOption[];
    placeholder?: string;
    filterPlaceholder?: string;
    disabled?: boolean;
    searchable?: boolean;
    autofocus?: boolean;
    onchange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let placeAbove = $state(false);
  let query = $state('');
  let highlightedIndex = $state(0);
  const listboxId = $props.id();

  let containerRef = $state<HTMLDivElement | null>(null);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let filterInputRef = $state<HTMLInputElement | null>(null);
  let listRef = $state<HTMLUListElement | null>(null);

  let selectedOption = $derived(options.find((o) => o.value === value) ?? null);
  let displayLabel = $derived(selectedOption ? selectedOption.label : placeholder);

  let filteredOptions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  });

  function scrollHighlightedIntoView() {
    if (!listRef) return;
    const el = listRef.children[highlightedIndex] as HTMLElement | undefined;
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  $effect(() => {
    const len = filteredOptions.length;
    const _q = query;
    if (len === 0) {
      highlightedIndex = 0;
      return;
    }
    if (highlightedIndex >= len) {
      highlightedIndex = len - 1;
    } else if (highlightedIndex < 0) {
      highlightedIndex = 0;
    }
    if (open && listRef) {
      requestAnimationFrame(() => scrollHighlightedIntoView());
    }
  });

  export function focus(): void {
    triggerRef?.focus();
  }

  export async function openPopover(): Promise<void> {
    if (disabled || open) return;
    query = '';
    const idx = options.findIndex((o) => o.value === value);
    highlightedIndex = idx >= 0 ? idx : 0;
    placeAbove = false;
    if (triggerRef && typeof window !== 'undefined') {
      const rect = triggerRef.getBoundingClientRect();
      if (rect.bottom + 240 > window.innerHeight && rect.top > 240) {
        placeAbove = true;
      }
    }
    open = true;
    await tick();
    if (searchable && filterInputRef) {
      filterInputRef.focus();
    } else {
      listRef?.focus();
    }
    scrollHighlightedIntoView();
  }

  export function closePopover(restoreFocus = false): void {
    if (!open) return;
    open = false;
    query = '';
    if (restoreFocus) {
      queueMicrotask(() => triggerRef?.focus());
    }
  }

  function selectOption(opt: SelectOption): void {
    const changed = value !== opt.value;
    value = opt.value;
    closePopover(true);
    if (changed) onchange?.(opt.value);
  }

  function handleTriggerKeydown(e: KeyboardEvent): void {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      void openPopover();
    }
  }

  function handlePopoverKeydown(e: KeyboardEvent): void {
    if (e.isComposing) {
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        query = '';
        highlightedIndex = 0;
      } else {
        closePopover(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredOptions.length === 0) return;
      highlightedIndex = (highlightedIndex + 1) % filteredOptions.length;
      scrollHighlightedIntoView();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredOptions.length === 0) return;
      highlightedIndex = (highlightedIndex - 1 + filteredOptions.length) % filteredOptions.length;
      scrollHighlightedIntoView();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const opt = filteredOptions[highlightedIndex];
      if (opt) selectOption(opt);
      return;
    }
    if (e.key === 'Tab') {
      closePopover(false);
    }
  }

  function handleWindowMousedown(e: MouseEvent): void {
    if (!open) return;
    const target = e.target as Node | null;
    if (target && !containerRef?.contains(target) && !popoverRef?.contains(target)) {
      closePopover(false);
    }
  }

  $effect(() => {
    if (!open) return;
    const unregisterEscape = viewManager.registerEscapeInterceptor(() => {
      if (!open) return false;
      if (query) {
        query = '';
        highlightedIndex = 0;
      } else {
        closePopover(true);
      }
      return true;
    });
    window.addEventListener('mousedown', handleWindowMousedown);
    return () => {
      unregisterEscape();
      window.removeEventListener('mousedown', handleWindowMousedown);
    };
  });

  onDestroy(() => {
    open = false;
  });
</script>

<div bind:this={containerRef} class="searchable-select" data-no-focus-steal>
  <button
    bind:this={triggerRef}
    {id}
    type="button"
    class="select-trigger"
    class:open
    class:is-placeholder={!selectedOption}
    {disabled}
    data-autofocus={autofocus ? 'true' : undefined}
    data-select-trigger
    role="combobox"
    aria-controls={listboxId}
    aria-expanded={open}
    aria-haspopup="listbox"
    onclick={() => (open ? closePopover(true) : void openPopover())}
    onkeydown={handleTriggerKeydown}
  >
    <span class="select-label">{displayLabel}</span>
    <svg class="select-caret" viewBox="0 0 10 6" fill="none" aria-hidden="true">
      <path
        d="M1 1l4 4 4-4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  {#if open}
    <div
      bind:this={popoverRef}
      class="select-popover launcher-popup"
      class:place-above={placeAbove}
      role="presentation"
      onkeydown={handlePopoverKeydown}
    >
      {#if searchable}
        <div class="select-filter launcher-popup-search">
          <Input
            textIntent="exact"
            bind:ref={filterInputRef}
            bind:value={query}
            placeholder={filterPlaceholder}
            autocomplete="off"
          />
        </div>
      {/if}
      <ul
        id={listboxId}
        bind:this={listRef}
        class="select-list custom-scrollbar"
        role="listbox"
        tabindex="-1"
      >
        {#each filteredOptions as opt, idx (opt.value)}
          <li role="none">
            <button
              type="button"
              role="option"
              aria-selected={opt.value === value}
              class="select-option"
              class:highlighted={idx === highlightedIndex}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => selectOption(opt)}
              onmouseenter={() => (highlightedIndex = idx)}
            >
              <span class="option-text">{opt.label}</span>
              {#if opt.value === value}
                <span class="option-check" aria-hidden="true">✓</span>
              {/if}
            </button>
          </li>
        {:else}
          <li class="select-empty">
            <EmptyState compact message={t('common.no_items_found')} />
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .searchable-select {
    position: relative;
    width: 100%;
  }

  .select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    line-height: 1.4;
    text-align: left;
    cursor: default;
    outline: none;
    transition:
      border-color var(--dur-quick) var(--ease-travel),
      box-shadow var(--dur-quick) var(--ease-travel);
  }

  .select-trigger:focus-visible,
  .select-trigger.open {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  .select-trigger:disabled {
    opacity: 0.5;
  }

  .select-trigger.is-placeholder .select-label {
    color: var(--text-tertiary);
  }

  .select-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .select-caret {
    width: var(--space-4);
    height: var(--space-3);
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: transform var(--dur-instant) var(--ease-travel);
  }

  .select-trigger.open .select-caret {
    transform: rotate(180deg);
  }

  .select-popover {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + var(--space-1));
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    max-height: calc(var(--shell-row-h) * 6);
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-popup);
    overflow: hidden;
  }

  .select-popover.place-above {
    top: auto;
    bottom: calc(100% + var(--space-1));
  }

  .select-filter {
    padding: var(--space-2);
    border-bottom: 1px solid var(--separator);
  }

  .select-list {
    flex: 1;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
  }

  .select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    border: none;
    background: transparent;
    text-align: left;
    font-family: var(--font-ui);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: default;
    user-select: none;
  }

  .select-option.highlighted {
    background: var(--bg-selected);
  }

  .select-option:hover:not(.highlighted) {
    background: var(--bg-hover);
  }

  .option-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option-check {
    color: var(--accent-primary);
    font-size: var(--font-size-xs);
    flex-shrink: 0;
  }

  .select-empty {
    list-style: none;
  }
</style>
