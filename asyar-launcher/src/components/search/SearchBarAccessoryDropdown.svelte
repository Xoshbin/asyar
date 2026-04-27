<script lang="ts">
  import KeyboardHint from '../base/KeyboardHint.svelte';

  type Option = { value: string; title: string };

  /**
   * Reusable dropdown popover for launcher chrome surfaces.
   *
   * Public methods (call via `bind:this` ref):
   *   - `focus()`: focus the trigger button.
   *   - `openPopover()`: open the popover and highlight the current value.
   *
   * Keyboard behavior:
   *   - Trigger button: Enter / Space / ArrowDown opens the popover.
   *   - Popover: ArrowUp/ArrowDown wrap-navigate, Enter selects, Escape
   *     closes and refocuses the trigger.
   *   - Tab is intentionally NOT trapped. Pressing Tab moves focus out;
   *     the next interaction dismisses the popover via click-outside.
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
  let highlightedIndex = $state(0);

  let currentTitle = $derived(
    options.find((o) => o.value === value)?.title ?? options[0]?.title ?? '',
  );

  export function focus(): void {
    buttonRef?.focus();
  }

  export function openPopover(): void {
    open = true;
    highlightedIndex = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
  }

  function closePopover(): void {
    open = false;
    onclose?.();
  }

  function selectIndex(idx: number): void {
    const opt = options[idx];
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
    if (options.length === 0) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
      buttonRef?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % options.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex =
        (highlightedIndex - 1 + options.length) % options.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectIndex(highlightedIndex);
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
</script>

<div class="accessory-wrap">
  <button
    bind:this={buttonRef}
    type="button"
    class="accessory-button"
    class:open
    onclick={openPopover}
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
      {#each options as opt, i}
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
