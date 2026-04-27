<script lang="ts">
  import { tick } from 'svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';

  type Option = { value: string; title: string };

  /**
   * Reusable dropdown popover for launcher chrome surfaces.
   *
   * Public methods (call via `bind:this` ref):
   *   - `focus()`: focus the trigger button.
   *   - `openPopover()`: open the popover, highlight the current value,
   *     reset the filter input, and move focus to the filter input so its
   *     keydown events bubble up to the popover's keydown handler
   *     (preventing those keys from bubbling up to the launcher's global
   *     keyboard chain).
   *   - `togglePopover()`: open if closed, close if open. The shortcut
   *     binding (⌘P) uses this so a second press dismisses the popover.
   *
   * Keyboard behavior:
   *   - Trigger button: Enter / Space / ArrowDown opens the popover.
   *   - Popover: focus lands on the filter input. Type to filter
   *     options (case-insensitive substring match on title).
   *     ArrowUp/Down wrap-navigate the filtered list, Enter selects,
   *     Escape closes + refocuses trigger, Tab closes (focus moves out).
   *   - All popover navigation keys stop propagation so the launcher's
   *     global handlers don't double-handle them.
   *   - Tab is intentionally NOT trapped. Pressing Tab closes the popover
   *     and lets focus move to the next focusable element naturally.
   *
   * `onclose` fires on every `open → closed` transition (Escape,
   * selection, click-outside). It does not fire on idempotent opens or
   * repeat closes.
   */
  let {
    options,
    value,
    onChange,
    onclose,
  }: {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    onclose?: () => void;
  } = $props();

  let open = $state(false);
  let buttonRef = $state<HTMLButtonElement | null>(null);
  let popoverRef = $state<HTMLDivElement | null>(null);
  let filterInputRef = $state<HTMLInputElement | null>(null);
  let highlightedIndex = $state(0);
  let filterQuery = $state('');

  let currentTitle = $derived(
    options.find((o) => o.value === value)?.title ?? options[0]?.title ?? '',
  );

  let filteredOptions = $derived(
    filterQuery.trim() === ''
      ? options
      : options.filter((o) =>
          o.title.toLowerCase().includes(filterQuery.trim().toLowerCase()),
        ),
  );

  // Re-clamp highlightedIndex whenever the filtered list changes (typing
  // into the filter can shrink the list past the current highlight).
  $effect(() => {
    // Touch filteredOptions so this re-runs when the filter changes.
    const len = filteredOptions.length;
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

  export function focus(): void {
    buttonRef?.focus();
  }

  export async function openPopover(): Promise<void> {
    if (open) return;
    filterQuery = '';
    open = true;
    // Highlight the currently-selected option if it exists in the unfiltered
    // list, otherwise default to 0. After typing into the filter,
    // highlightedIndex re-clamps to the filtered range — see the $effect
    // above.
    highlightedIndex = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    // Wait for the {#if open} branch to render, then move focus to the
    // filter input so keystrokes land there. The popover div's keydown
    // handler still receives Arrow/Enter/Escape/Tab via bubbling.
    await tick();
    filterInputRef?.focus();
  }

  export function togglePopover(): void {
    if (open) {
      closePopover();
      buttonRef?.focus();
    } else {
      void openPopover();
    }
  }

  function closePopover(): void {
    open = false;
    onclose?.();
  }

  function selectIndex(idx: number): void {
    const opt = filteredOptions[idx];
    if (!opt) return;
    onChange(opt.value);
    closePopover();
  }

  function onButtonKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openPopover();
    }
  }

  function onPopoverKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
      buttonRef?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredOptions.length === 0) return;
      highlightedIndex = (highlightedIndex + 1) % filteredOptions.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredOptions.length === 0) return;
      highlightedIndex =
        (highlightedIndex - 1 + filteredOptions.length) %
        filteredOptions.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredOptions.length === 0) return;
      selectIndex(highlightedIndex);
    } else if (e.key === 'Tab') {
      // Close on Tab so focus can leave the popover cleanly. Don't
      // preventDefault — let the browser move focus to the next focusable.
      closePopover();
    }
  }

  function onWindowMousedown(e: MouseEvent) {
    if (!open) return;
    const target = e.target as Node | null;
    if (
      target &&
      !buttonRef?.contains(target) &&
      !popoverRef?.contains(target)
    ) {
      closePopover();
    }
  }

  $effect(() => {
    if (!open) return;
    window.addEventListener('mousedown', onWindowMousedown);
    return () => window.removeEventListener('mousedown', onWindowMousedown);
  });

  // Mirror local `open` into the service so the launcher's global keydown
  // chain can bail out for navigation keys while the popover is up. The
  // launcher registers its window-level keydown listener with
  // { capture: true } at page mount; per the DOM spec, capture-phase
  // listeners on the same target fire in registration order, so a popover-
  // owned capture listener registered later can't beat it. Tracking popover
  // state on the singleton lets `handleGlobalKeydown` early-return for
  // Escape/Arrow/Enter/Tab while open, leaving the popover div's bubble-
  // phase `onPopoverKeydown` to handle those keys.
  $effect(() => {
    searchBarAccessoryService.popoverOpen = open;
    return () => {
      searchBarAccessoryService.popoverOpen = false;
    };
  });
</script>

<div class="accessory-wrap">
  <button
    bind:this={buttonRef}
    type="button"
    class="accessory-button"
    class:open
    onclick={togglePopover}
    onkeydown={onButtonKeydown}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <span class="accessory-title">{currentTitle}</span>
    <svg
      class="accessory-chevron"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,3.5 5,6.5 8,3.5" />
    </svg>
  </button>
  <KeyboardHint keys={['⌘', 'P']} />

  {#if open}
    <div
      bind:this={popoverRef}
      class="accessory-popover custom-scrollbar"
      role="listbox"
      tabindex="-1"
      onkeydown={onPopoverKeydown}
    >
      <div class="accessory-filter-row">
        <input
          bind:this={filterInputRef}
          bind:value={filterQuery}
          type="text"
          class="accessory-filter-input"
          placeholder="Type to filter…"
          aria-label="Filter options"
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      {#if filteredOptions.length === 0}
        <div class="accessory-empty">No matches</div>
      {:else}
        {#each filteredOptions as opt, i}
          <button
            type="button"
            class="accessory-option"
            class:highlighted={i === highlightedIndex}
            class:selected={opt.value === value}
            role="option"
            aria-selected={opt.value === value}
            onclick={() => selectIndex(i)}
            onmouseenter={() => (highlightedIndex = i)}
          >
            <span class="accessory-check">
              {#if opt.value === value}
                <svg
                  viewBox="0 0 10 8"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M1 4L3.8 7L9 1" />
                </svg>
              {/if}
            </span>
            <span>{opt.title}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .accessory-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .accessory-button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-normal),
      box-shadow var(--transition-normal);
  }
  .accessory-button:hover {
    background: var(--bg-hover);
  }
  .accessory-button:focus-visible {
    box-shadow: var(--shadow-focus);
    outline: none;
  }
  .accessory-button.open {
    background: var(--bg-selected);
  }
  .accessory-title {
    font-weight: 500;
    color: var(--text-primary);
  }
  .accessory-chevron {
    width: var(--space-5);
    height: var(--space-5);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .accessory-popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    min-width: 180px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popup);
    padding: var(--space-1);
    z-index: 60;
  }

  .accessory-filter-row {
    padding: var(--space-2) var(--space-2) var(--space-1);
    border-bottom: 1px solid var(--separator);
    margin-bottom: var(--space-1);
  }

  .accessory-filter-input {
    width: 100%;
    background: transparent;
    color: var(--text-primary);
    border: none;
    outline: none;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
  }

  .accessory-filter-input::placeholder {
    color: var(--text-tertiary);
  }

  /* .accessory-filter-input:focus-visible — outline omitted intentionally;
     the popover border + filter underline already provide visual focus
     context. */

  .accessory-empty {
    padding: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    text-align: center;
  }

  .accessory-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
  }
  .accessory-option.highlighted,
  .accessory-option:hover {
    background: var(--bg-hover);
  }
  .accessory-option.selected {
    color: var(--accent-primary);
  }
  .accessory-check {
    width: var(--space-5);
    height: var(--space-5);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    flex-shrink: 0;
  }
  .accessory-check svg {
    width: var(--space-4);
    height: var(--space-3);
  }
</style>
