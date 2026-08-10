<script lang="ts">
  import { Badge, Input, SearchBarAccessoryDropdown } from '..';
  import { tick } from 'svelte';
  import { developmentBuildIndicator } from '../../lib/developmentBuild';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import ArgumentChipRow from '../search/ArgumentChipRow.svelte';
  import CommandArgInput from '../search/CommandArgInput.svelte';
  import type { CommandArgument } from 'asyar-sdk/contracts';
  import type { ActiveArgumentMode } from '../../services/search/commandArgumentsService.svelte';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { logService } from '../../services/log/logService';
  import { looksLikeAIIntent } from './aiHintIntensity';
  import { createWindowDragController } from '../../services/launcher/windowDragController';

  // Public handle exposed via `bind:accessoryRef={...}` so the global
  // keyboard chain (⌘P) can call togglePopover() from outside this component.
  type AccessoryHandle = { focus: () => void; openPopover: () => void; togglePopover: () => void };

  let {
    value = $bindable(''),
    showBack = false,
    searchable = true,
    placeholder = 'Search...',
    ref = $bindable(null as HTMLInputElement | null),
    accessoryRef = $bindable(null as AccessoryHandle | null),
    activeContext = null,
    activeViewId = null,
    contextQuery = $bindable(''),
    contextHint = null,
    argumentMode = null,
    argumentHint = false,
    argumentHintFields = [],
    argumentCommandName = null,
    onArgHintClick,
    onclick,
    oncontextDismiss,
    oncontextQueryChange,
    onArgValueChange,
    onArgValueReset,
    onArgFocusField,
    onArgFieldsBlur,
    onArgNext,
    onArgPrev,
    onArgSubmit,
    onArgExit,
    onkeydown,
    oninput,
  }: {
    value?: string;
    showBack?: boolean;
    searchable?: boolean;
    placeholder?: string;
    ref?: HTMLInputElement | null;
    accessoryRef?: AccessoryHandle | null;
    activeContext?: { id: string; name: string; icon: string; color?: string } | null;
    activeViewId?: string | null;
    contextQuery?: string;
    contextHint?: { id: string; name: string; icon: string; type?: string } | null;
    argumentMode?: ActiveArgumentMode | null;
    /** Selected result accepts input: show the ghost argument chips. */
    argumentHint?: boolean;
    /** One chip per declared argument, rendered with the same component
     *  argument mode uses. Empty while a dynamic command's schema resolves.
     *  `touched` marks a dropdown the user picked before escaping out, so the
     *  preview greys the same values argument mode would. */
    argumentHintFields?: {
      arg: CommandArgument;
      value: string;
      touched?: boolean;
      needsValue?: boolean;
    }[];
    /** Stands in for the query while it is empty, in placeholder grey. */
    argumentCommandName?: string | null;
    onArgHintClick?: (fieldIdx: number) => void;
    onclick?: () => void;
    oncontextDismiss?: () => void;
    oncontextQueryChange?: (detail: { query: string }) => void;
    onArgValueChange?: (name: string, value: string) => void;
    onArgValueReset?: (name: string) => void;
    onArgFocusField?: (idx: number) => void;
    /** The query took focus, so the chip row is no longer on any field. */
    onArgFieldsBlur?: () => void;
    onArgNext?: () => void;
    onArgPrev?: () => void;
    onArgSubmit?: () => void;
    onArgExit?: () => void;
    onkeydown?: (e: KeyboardEvent) => void;
    oninput?: (e: Event) => void;
  } = $props();

  let prevContextId = $state<string | null>(null);
  let prevViewId = $state<string | null>(null);

  $effect(() => {
    if (activeContext?.id !== prevContextId) {
      prevContextId = activeContext?.id ?? null;
      if (activeContext) {
        tick().then(() => {
          if (document.activeElement !== ref) {
            ref?.focus();
          }
        });
      }
    }
  });

  // Hotkey-triggered extension swaps unmount the prior view's focused
  // element, dropping DOM focus to <body>.
  $effect(() => {
    if (activeViewId !== prevViewId) {
      prevViewId = activeViewId;
      if (activeViewId && searchable) {
        tick().then(() => {
          if (document.activeElement !== ref) {
            ref?.focus();
          }
        });
      }
    }
  });

  // Leaving argument mode unmounts the focused chip input, dropping DOM focus
  // to <body>. Hand it back to the search field with the query selected, so
  // typing starts a fresh search in one keystroke.
  let wasArgumentMode = $state(false);
  $effect(() => {
    const now = argumentMode != null;
    if (wasArgumentMode && !now) {
      tick().then(() => {
        // Typing in the query is itself an exit path, and selecting here
        // would wipe the keystroke that triggered it.
        if (document.activeElement === ref) return;
        ref?.focus();
        ref?.select();
      });
    }
    wasArgumentMode = now;
  });

  function handleBackClick() {
    onclick?.();
  }

  function dismissContext() {
    oncontextDismiss?.();
  }

  function handleContextInput(e: Event) {
    oncontextQueryChange?.({ query: contextQuery });
  }

  // The chips trail the typed text by a fixed gap, so the query is mirrored
  // into a hidden span and measured. Reading offsetWidth post-render keeps
  // that in sync without a ResizeObserver.
  const ARG_HINT_GAP = 12;
  // Stand-in while a dynamic command's schema is still resolving over IPC.
  const FALLBACK_HINT_FIELDS: NonNullable<typeof argumentHintFields> = [
    { arg: { name: 'input', type: 'text', placeholder: 'Input…' }, value: '' },
  ];
  let argMeasureEl = $state<HTMLElement | null>(null);
  let argHintTextW = $state(0);
  // Whatever text the chips currently trail. With the query empty that is the
  // command name standing in for it, so the gap has to be measured off that
  // instead of collapsing to zero and sliding the chips under it.
  const argLeadText = $derived(
    value || ((argumentHint || argumentMode) && argumentCommandName) || '',
  );
  $effect(() => {
    void argLeadText;
    if ((argumentHint || argumentMode) && argMeasureEl) argHintTextW = argMeasureEl.offsetWidth;
  });

  let argRowRef = $state<ReturnType<typeof ArgumentChipRow> | null>(null);

  function focusQuerySelected(): void {
    ref?.focus();
    ref?.select();
  }

  /**
   * In argument mode the query is the leftmost slot of the arrow-key walk:
   * Right off the end of the text enters the first field, and Left at the
   * very start has nowhere to go. A selection collapses towards the
   * direction of travel first.
   */
  function handleQueryKeydown(e: KeyboardEvent): void {
    // Closes the Tab ring: forward from the query enters the first field,
    // backward enters the last. Outside argument mode Tab still falls
    // through to the global chain, which is what promotes into the mode.
    if (argumentMode && e.key === 'Tab') {
      e.preventDefault();
      argRowRef?.focusFieldSelected(e.shiftKey ? argumentMode.args.length - 1 : 0);
      return;
    }
    // The ring lands here too, so Enter means what it means in a chip:
    // submit the form, never run the command bare.
    if (argumentMode && e.key === 'Enter') {
      e.preventDefault();
      onArgSubmit?.();
      return;
    }
    if (argumentMode && ref && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const forward = e.key === 'ArrowRight';
      const start = ref.selectionStart ?? 0;
      const end = ref.selectionEnd ?? 0;
      if (end > start) {
        e.preventDefault();
        const pos = forward ? end : start;
        ref.setSelectionRange(pos, pos);
        return;
      }
      if (forward && start >= ref.value.length) {
        e.preventDefault();
        argRowRef?.focusFieldSelected(0);
        return;
      }
      if (!forward && start <= 0) {
        e.preventDefault();
        return;
      }
    }
    onkeydown?.(e);
  }

  let hintLabel = $derived(contextHint?.type === 'ai' ? 'Ask AI' : 'Tab');
  let chipColor = $derived(activeContext?.color ?? 'var(--accent-primary)');
  let aiHintMuted = $derived(contextHint?.type === 'ai' && !looksLikeAIIntent(value));

  // `accessoryRef` is exposed as a $bindable prop above so the global
  // keyboard chain (⌘P) can open the popover from outside this component.
  // It is bound below via `bind:this={accessoryRef}` on the dropdown.

  let accessory = $derived(searchBarAccessoryService.active);

  // The header doubles as the launcher's drag handle — the window is
  // undecorated, so there is no title bar to grab. The controller ignores
  // presses that land on the input or a button and only starts once the
  // pointer clears a few pixels, so click-to-focus still works.
  const drag = createWindowDragController('main');

  function onHeaderPointerDown(e: PointerEvent) {
    drag.onPointerDown(e);
    window.addEventListener('pointermove', onHeaderPointerMove);
    window.addEventListener('pointerup', onHeaderPointerUp, { once: true });
  }

  function onHeaderPointerMove(e: PointerEvent) {
    drag.onPointerMove(e);
  }

  function onHeaderPointerUp() {
    window.removeEventListener('pointermove', onHeaderPointerMove);
    drag.onPointerUp();
  }

  function onAccessoryChange(value: string): void {
    if (!accessory) return;
    searchBarAccessoryService
      .setSelected(accessory.extensionId, accessory.commandId, value)
      .catch((err) => logService.warn(`[SearchHeader] accessory setSelected failed: ${err}`));
  }
</script>

<div class="search-header">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative w-full border-b border-[var(--separator)] flex items-center min-h-[var(--shell-header-h)] px-4 gap-3"
    onpointerdown={onHeaderPointerDown}
  >
    {#if showBack}
      <button
        type="button"
        class="back-button-new"
        tabindex="-1"
        onclick={handleBackClick}
        title="Press Escape to go back"
        aria-label="Go back"
      >
        <KeyboardHint keys="←" />
      </button>
    {/if}

    {#if activeContext && !argumentMode}
      <div class="context-search-row">
        <span class="context-chip" style="background: {chipColor}">
          <span class="chip-icon">
            {#if isBuiltInIcon(activeContext.icon)}
              <Icon name={getBuiltInIconName(activeContext.icon)} size={13} />
            {:else if isIconImage(activeContext.icon)}
              <img src={activeContext.icon} alt="" class="w-4 h-4 object-contain" />
            {:else}
              {activeContext.icon}
            {/if}
          </span>
          <span class="chip-name">{activeContext.name}</span>
          <button
            class="chip-dismiss"
            onclick={dismissContext}
            tabindex="-1"
            aria-label="Exit context mode">×</button
          >
        </span>
        <Input
          textIntent="exact"
          bind:ref
          type="text"
          bind:value={contextQuery}
          placeholder="Query..."
          autocomplete="off"
          unstyled
          class="context-query-input"
          oninput={handleContextInput}
          {onkeydown}
        />
      </div>
    {:else}
      <div class="search-input-row">
        <Input
          textIntent="exact"
          bind:ref
          type="text"
          placeholder={(argumentHint || argumentMode) && !value
            ? (argumentCommandName ?? '')
            : placeholder}
          disabled={!searchable}
          bind:value
          autocomplete="off"
          unstyled
          class="search-input-clean"
          {oninput}
          onkeydown={handleQueryKeydown}
          onfocus={() => onArgFieldsBlur?.()}
        />
        {#if argumentHint || argumentMode}
          <span
            class="arg-measure"
            class:arg-measure--placeholder={!value}
            bind:this={argMeasureEl}
            aria-hidden="true">{argLeadText}</span
          >
        {/if}
        {#if argumentMode}
          <div
            class="arg-field-row"
            style:left="min({argHintTextW + ARG_HINT_GAP}px, calc(100% - 60px))"
            style:max-width="max(60px, calc(100% - {argHintTextW + ARG_HINT_GAP}px))"
          >
            <ArgumentChipRow
              bind:this={argRowRef}
              active={argumentMode}
              onValueChange={(name, v) => onArgValueChange?.(name, v)}
              onValueReset={(name) => onArgValueReset?.(name)}
              onFocusField={(idx) => onArgFocusField?.(idx)}
              onNext={() => onArgNext?.()}
              onPrev={() => onArgPrev?.()}
              onSubmit={() => onArgSubmit?.()}
              onExit={() => onArgExit?.()}
              onMoveToQuery={focusQuerySelected}
            />
          </div>
        {:else if argumentHint}
          <div
            class="arg-hint-row"
            style:left="min({argHintTextW + ARG_HINT_GAP}px, calc(100% - 60px))"
            style:max-width="max(60px, calc(100% - {argHintTextW + ARG_HINT_GAP}px))"
          >
            {#each argumentHintFields.length ? argumentHintFields : FALLBACK_HINT_FIELDS as field, i}
              <CommandArgInput
                arg={field.arg}
                value={field.value}
                touched={field.touched === true}
                needsValue={field.needsValue === true}
                focused={false}
                readonly
                onInput={() => {}}
                onKeydown={() => {}}
                onClick={() => onArgHintClick?.(i)}
              />
            {/each}
          </div>
        {:else if contextHint}
          <span class="context-hint" class:context-hint--muted={aiHintMuted}>
            <span class="hint-text">
              <span class="hint-icon">
                {#if isBuiltInIcon(contextHint.icon)}
                  <Icon name={getBuiltInIconName(contextHint.icon)} size={13} />
                {:else if isIconImage(contextHint.icon)}
                  <img src={contextHint.icon} alt="" class="w-4 h-4 object-contain" />
                {:else}
                  {contextHint.icon}
                {/if}
              </span>
              <span class="hint-label">{hintLabel}</span>
            </span>
            <KeyboardHint keys="Tab" />
          </span>
        {/if}
        <!-- Note: context chips and the searchbar accessory share the right slot in
             this {:else} branch. If both are populated (rare race during hotkey-
             driven view navigation while a context chip is active), the {:else if
             activeContext} branch above wins and this block does not render. -->
        {#if !argumentMode && accessory}
          <SearchBarAccessoryDropdown
            bind:this={accessoryRef}
            options={accessory.options}
            value={accessory.value}
            onChange={onAccessoryChange}
          />
        {/if}
      </div>
    {/if}
    {#if developmentBuildIndicator}
      <span
        class="shrink-0"
        title={developmentBuildIndicator.title}
        aria-label={developmentBuildIndicator.title}
      >
        <Badge text={developmentBuildIndicator.text} variant="warning" mono bordered />
      </span>
    {/if}
  </div>
</div>

<style>
  .search-input-row {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 100%;
    position: relative;
  }
  :global(.search-input-clean) {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    caret-color: color-mix(
      in srgb,
      var(--text-primary) 60%,
      var(--bg-secondary-full-opacity) 40%
    ) !important;
    font-size: var(--font-size-xl);
    font-weight: 600;
    padding: 0;
  }
  :global(.search-input-clean::placeholder) {
    color: color-mix(in srgb, var(--text-primary) 50%, var(--bg-secondary-full-opacity) 50%);
    font-weight: 500;
  }
  .back-button-new {
    display: inline-flex;
    align-items: center;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }
  .back-button-new :global(kbd) {
    transition:
      background-color var(--transition-normal),
      color var(--transition-normal);
  }
  .back-button-new:hover :global(kbd) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  /* Mirrors .search-input-clean typography so offsetWidth matches the
     rendered query the chips trail. */
  .arg-measure {
    position: absolute;
    left: 0;
    top: 0;
    visibility: hidden;
    pointer-events: none;
    white-space: pre;
    font-size: var(--font-size-xl);
    font-weight: 600;
  }
  /* The placeholder renders a weight lighter than typed text, so measuring it
     at 600 would overshoot and push the chips too far right. */
  .arg-measure--placeholder {
    font-weight: 500;
  }
  /* Both rows occupy the same slot, so Tab into argument mode leaves the
     chips exactly where they were. */
  .arg-hint-row,
  .arg-field-row {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* Click-through except on the chips themselves, so clicking the gaps still
     focuses the query. */
  .arg-hint-row {
    overflow: hidden;
    pointer-events: none;
  }
  /* Not clipped: a hidden overflow scrolls the row on focus and clips the
     caret at its trailing edge. */
  .arg-field-row {
    overflow: visible;
  }
  .context-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    pointer-events: none;
    transition: opacity var(--transition-fast);
  }
  .context-hint--muted {
    opacity: 0.55;
  }
  .hint-text {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-tertiary);
  }
  .hint-icon {
    font-size: var(--font-size-md);
    display: inline-flex;
    align-items: center;
  }
  .hint-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .context-search-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .context-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-on-accent);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    box-shadow: var(--shadow-xs);
  }
  .chip-icon {
    font-size: var(--font-size-md);
  }
  .chip-name {
    font-size: var(--font-size-sm);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-dismiss {
    background: none;
    border: none;
    color: color-mix(in srgb, var(--text-on-accent) 75%, transparent);
    cursor: pointer;
    padding: 0 var(--space-1);
    font-size: var(--font-size-lg);
    line-height: 1;
    display: flex;
    align-items: center;
    border-radius: var(--radius-xs);
    margin-left: var(--space-0-5);
  }
  .chip-dismiss:hover {
    color: var(--text-on-accent);
    background: color-mix(in srgb, var(--text-on-accent) 15%, transparent);
  }
  :global(.context-query-input) {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    caret-color: color-mix(
      in srgb,
      var(--text-primary) 60%,
      var(--bg-secondary-full-opacity) 40%
    ) !important;
    font-size: var(--font-size-xl);
    font-weight: 600;
    padding: 0;
    min-width: 0;
  }
  :global(.context-query-input::placeholder) {
    color: color-mix(in srgb, var(--text-primary) 35%, var(--bg-secondary-full-opacity) 65%);
  }
</style>
