<script lang="ts">
  // Direct, not via the barrel: this chip is rendered under test, and the
  // barrel drags the whole component index in with it.
  import Input from '../base/Input.svelte';
  import LauncherListRow from '../list/LauncherListRow.svelte';
  import EmptyState from '../feedback/EmptyState.svelte';
  import { tick } from 'svelte';
  import type { CommandArgument } from 'asyar-sdk/contracts';

  /**
   * A dropdown argument, as a chip that carries its own filterable list.
   *
   * Two states the chip distinguishes: the value it was *seeded* with, shown
   * greyed because the user has not weighed in yet, and a value they picked,
   * shown in full. Up/Down walk that ring with the list closed — the slot
   * before the first option is the seeded one, so arrowing back up to it
   * greys the chip again. Typing opens the list on that keystroke.
   */
  let {
    arg,
    value,
    touched = false,
    focused = false,
    readonly = false,
    onSelect,
    onReset,
    onKeydown,
    onFocus,
  }: {
    arg: CommandArgument;
    value: string;
    /** The user picked this value, rather than it being seeded for them. */
    touched?: boolean;
    focused?: boolean;
    /** Ghost mode: the hint chip shown before argument mode is entered. */
    readonly?: boolean;
    onSelect: (value: string) => void;
    /** Back to the seeded value, untouched — the "-" row and Up off the top. */
    onReset: () => void;
    /** Keys the chip does not own, handed to the field row's walk. */
    onKeydown: (e: KeyboardEvent) => void;
    /** The trigger took DOM focus, however it got there. */
    onFocus?: () => void;
  } = $props();

  type Option = { value: string; title: string };
  /** A list row: `null` is the seeded-value slot, rendered as "-". */
  type Row = { value: string | null; title: string };

  const listId = $props.id();
  /** Breathing room kept between the list and the launcher's right edge. */
  const EDGE_GAP = 12;

  let open = $state(false);
  let filter = $state('');
  let highlighted = $state(0);
  let shiftX = $state(0);
  let wrapEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let filterEl = $state<HTMLInputElement | null>(null);
  let popoverEl = $state<HTMLElement | null>(null);

  const options = $derived<Option[]>(arg.data ?? []);
  const needle = $derived(filter.trim().toLowerCase());
  const matches = $derived(
    needle === '' ? options : options.filter((o) => o.title.toLowerCase().includes(needle)),
  );
  // The "-" row is only offered unfiltered: a search is over options the user
  // could have meant, and "no selection" is never one of them.
  const rows = $derived<Row[]>(needle === '' ? [{ value: null, title: '-' }, ...matches] : matches);

  const selectedTitle = $derived(options.find((o) => o.value === value)?.title ?? '');
  const label = $derived(selectedTitle || arg.placeholder?.trim() || arg.name);
  /** Position in the closed-list ring: -1 is the seeded slot. */
  const ringPos = $derived(touched ? options.findIndex((o) => o.value === value) : -1);

  // Arrival focuses the trigger, the same way a text chip focuses its input.
  // Only the arrival: every close hands focus back itself, and re-running this
  // whenever the list opens or shuts would pull focus off whatever the field
  // handed it to — the search query, after a Tab out of an open list.
  let hadFocus = $state(false);
  $effect(() => {
    const now = focused && !readonly;
    if (now && !hadFocus) {
      void tick().then(() => {
        if (!open && document.activeElement !== triggerEl) triggerEl?.focus();
      });
    }
    hadFocus = now;
  });

  // Typing can shrink the list past the highlight.
  $effect(() => {
    if (highlighted >= rows.length) highlighted = Math.max(0, rows.length - 1);
  });

  function rowIndexOfCurrent(): number {
    const target = touched ? value : null;
    return Math.max(
      0,
      rows.findIndex((r) => r.value === target),
    );
  }

  async function openList(seed: string): Promise<void> {
    if (readonly || open) return;
    filter = seed;
    open = true;
    highlighted = seed === '' ? rowIndexOfCurrent() : 0;
    // Wait for the {#if open} branch, then hand the list its own input so
    // keystrokes filter instead of reaching the chip row's walk.
    await tick();
    filterEl?.focus();
    // The last chip of three sits close to the right edge, and the list hangs
    // off it: pull it back inside rather than letting the window clip it.
    const overflow = popoverEl ? popoverEl.getBoundingClientRect().right - window.innerWidth : 0;
    if (overflow > 0) shiftX = -(overflow + EDGE_GAP);
  }

  function closeList(opts?: { refocus?: boolean }): void {
    if (!open) return;
    open = false;
    filter = '';
    shiftX = 0;
    if (opts?.refocus !== false) triggerEl?.focus();
  }

  function commit(row: Row): void {
    if (row.value === null) onReset();
    else onSelect(row.value);
    closeList();
  }

  /**
   * Step the value with the list closed. Neither end wraps: one end is the
   * seeded slot, and wrapping onto it from the last option would read as a
   * selection rather than a retreat.
   */
  function step(delta: number): void {
    if (!options.length) return;
    const next = Math.max(-1, Math.min(ringPos + delta, options.length - 1));
    if (next === ringPos) return;
    if (next < 0) onReset();
    else onSelect(options[next].value);
  }

  /** A keystroke that means "start searching this list". */
  function isTypeAhead(e: KeyboardEvent): boolean {
    return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
  }

  function onTriggerKeydown(e: KeyboardEvent): void {
    if (readonly) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && touched) {
      // Clearing a chip the user filled in, the same as emptying a text one.
      e.preventDefault();
      onReset();
      return;
    }
    if (isTypeAhead(e)) {
      e.preventDefault();
      // Space is the native select's "just open it", not a search for " ".
      void openList(e.key === ' ' ? '' : e.key);
      return;
    }
    onKeydown(e);
  }

  function onListKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!rows.length) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      highlighted = (highlighted + delta + rows.length) % rows.length;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const row = rows[highlighted];
      if (row) commit(row);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // One layer per press: the search text first, the list only once there
      // is nothing left to clear. The chip keeps focus either way.
      if (filter !== '') {
        filter = '';
        highlighted = rowIndexOfCurrent();
        return;
      }
      closeList();
      return;
    }
    if (e.key === 'Tab') {
      // Tab belongs to the field ring, so give the list's slot up and let the
      // row move focus. Deleting the search text does not close the list, so
      // this is the only way out that isn't Escape or a pick.
      closeList({ refocus: false });
      onKeydown(e);
      return;
    }
  }

  function onFilterInput(e: Event): void {
    const text = (e.currentTarget as HTMLInputElement).value.trim();
    // Emptying the box is not "no match" — it returns the list to the state a
    // plain open would have shown, current value highlighted and all.
    highlighted = text === '' ? rowIndexOfCurrent() : 0;
  }

  // `relatedTarget` is not filled in reliably across engines, so let focus
  // settle and then ask where it actually landed. Opening the list moves
  // focus from the trigger to the filter input, which is a focusout too.
  function onWrapFocusOut(): void {
    if (!open) return;
    void tick().then(() => {
      if (!open || wrapEl?.contains(document.activeElement)) return;
      // Focus has already left, so don't drag it back to the trigger.
      open = false;
      filter = '';
    });
  }

  // A mousedown on something unfocusable (the results list, the window
  // chrome) never fires focusout, so the list needs its own outside-click.
  $effect(() => {
    if (!open) return;
    const onMousedown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && wrapEl?.contains(target)) return;
      open = false;
      filter = '';
    };
    window.addEventListener('mousedown', onMousedown);
    return () => window.removeEventListener('mousedown', onMousedown);
  });
</script>

<div class="arg-dropdown" bind:this={wrapEl} onfocusout={onWrapFocusOut}>
  <button
    bind:this={triggerEl}
    type="button"
    class="arg-trigger"
    class:arg-trigger--touched={touched}
    data-arg-focus-target={(focused && !readonly) || undefined}
    tabindex={readonly ? -1 : 0}
    onclick={() => (open ? closeList() : void openList(''))}
    onkeydown={onTriggerKeydown}
    onfocus={() => onFocus?.()}
    aria-haspopup="listbox"
    role="combobox"
    aria-controls={listId}
    aria-expanded={open}
    aria-label={arg.placeholder?.trim() || arg.name}
    aria-required={arg.required ? 'true' : undefined}
  >
    <span class="arg-trigger-label">{label}</span>
    <svg
      class="arg-chevron"
      class:arg-chevron--up={open}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,4 5,7 8,4" />
    </svg>
  </button>

  {#if open}
    <div
      class="arg-popover launcher-popup"
      bind:this={popoverEl}
      style:transform={shiftX ? `translateX(${shiftX}px)` : undefined}
    >
      <div class="arg-popover-search launcher-popup-search">
        <Input
          textIntent="exact"
          bind:ref={filterEl}
          bind:value={filter}
          type="text"
          placeholder="Search…"
          aria-label="Search {arg.placeholder?.trim() || arg.name}"
          aria-autocomplete="list"
          autocomplete="off"
          oninput={onFilterInput}
          onkeydown={onListKeydown}
        />
      </div>
      {#if rows.length === 0}
        <EmptyState message="No Results" />
      {:else}
        <!-- Pressing a row must not move focus off the search box: the list
             closes itself when focus leaves, and it would do so on the press,
             taking the row out from under the click that was about to pick it.
             Only the list, so the search box can still be clicked into. -->
        <div
          class="arg-popover-list custom-scrollbar"
          role="listbox"
          id={listId}
          tabindex="-1"
          onmousedown={(e) => e.preventDefault()}
        >
          {#each rows as row, i (row.value ?? ' unset')}
            <LauncherListRow
              title={row.title}
              selected={i === highlighted}
              role="option"
              aria-selected={row.value !== null && row.value === value && touched}
              tabindex="-1"
              onclick={() => commit(row)}
              onmouseenter={() => (highlighted = i)}
            />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .arg-dropdown {
    position: relative;
    display: inline-flex;
    min-width: 0;
    /* Passes the chip's corner down to the trigger, which inherits from here
       rather than from the chip itself. */
    border-radius: inherit;
  }
  /* Fills the chip so the whole surface toggles the list. */
  .arg-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 200px;
    padding: 3px var(--space-3);
    background: transparent;
    border: none;
    border-radius: inherit;
    /* Greyed until the user weighs in: what shows is a value chosen for them. */
    color: var(--text-secondary);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
  }
  /* The chip's own border carries focus, the same as a text chip — those are
     inputs, which the global focus ring already exempts. */
  .arg-trigger:focus,
  .arg-trigger:focus-visible {
    outline: none;
    box-shadow: none;
  }
  /* Untouched: the author's suggestion, marked the same way a seeded text
     chip is, so both kinds of chip read alike. */
  .arg-trigger:not(.arg-trigger--touched) .arg-trigger-label {
    text-decoration: underline dotted currentColor;
    text-underline-offset: 3px;
  }
  .arg-trigger--touched {
    color: var(--text-primary);
  }
  .arg-trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arg-chevron {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    transition: transform var(--transition-fast);
  }
  .arg-chevron--up {
    transform: rotate(180deg);
  }

  /* Surface, search row and rows are the action popup's, from style.css.
     Only the geometry is this list's own: it hangs off its chip rather than
     being pinned to a corner of the window. */
  .arg-popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    display: flex;
    flex-direction: column;
    min-width: max(180px, 100%);
    max-width: 260px;
    overflow: hidden;
    z-index: 60;
  }
  /* Taller and further in than the action popup's row: that one butts against
     a flat window edge, this one sits under a 20px corner and needs the room
     to clear it. The 16px inset also lines the query up with the row titles
     below (8px list padding + 9px row padding). */
  .arg-popover-search {
    height: 48px;
    padding: 0 var(--space-6);
    border-bottom: 1px solid var(--popup-divider);
  }
  /* An empty list is a state, not a problem: it says so at row weight and
     row size, in the same grey as a placeholder. */
  .arg-popover :global(.empty-state) {
    padding: var(--space-7) var(--space-6);
  }
  .arg-popover :global(.empty-state-message) {
    font-size: var(--font-size-md);
    font-weight: 400;
    color: var(--text-secondary);
  }
  .arg-popover-list {
    /* ~4 rows before it scrolls, matching the action popup's row height. */
    max-height: 172px;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Top inset is margin so the macOS overlay scrollbar track starts below
       the search row's hairline. */
    margin-top: var(--space-3);
    padding: 0 var(--space-3) var(--space-3);
  }
</style>
