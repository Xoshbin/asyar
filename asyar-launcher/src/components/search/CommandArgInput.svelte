<script lang="ts">
  // Direct, not via the barrel: this chip is rendered under test, and the
  // barrel drags the whole component index in with it.
  import Input from '../base/Input.svelte';
  import ArgumentDropdownChip from './ArgumentDropdownChip.svelte';
  import { tick } from 'svelte';
  import type { CommandArgument } from 'asyar-sdk/contracts';

  let {
    arg,
    value,
    focused,
    onInput,
    onKeydown,
    onFocus,
    readonly = false,
    needsValue = false,
    touched = false,
    onReset,
    onClick,
  }: {
    arg: CommandArgument;
    value: string;
    focused: boolean;
    /** Required, already seen, and still empty: flagged in place. */
    needsValue?: boolean;
    /** Dropdowns only: the value is the user's pick, not a seeded one. */
    touched?: boolean;
    onInput: (value: string) => void;
    onKeydown: (e: KeyboardEvent) => void;
    /** The field took DOM focus, however it got there. */
    onFocus?: () => void;
    /** Dropdowns only: back to the seeded value, untouched. */
    onReset?: () => void;
    /** Ghost mode: the hint chip shown before argument mode is entered. */
    readonly?: boolean;
    onClick?: () => void;
  } = $props();

  let inputRef = $state<HTMLInputElement | null>(null);
  let chipEl = $state<HTMLElement | null>(null);

  /**
   * A press anywhere on the chip belongs to its field. Without this the chip's
   * own padding is a plain div, so pressing it drops focus to the document and
   * the launcher stops answering the keyboard entirely: the row opts out of
   * having its focus pulled back to the query, and nothing else claims it.
   *
   * Handled on mousedown rather than click, because the damage is done by the
   * press. It is also what makes the dropdown a toggle: without it the press
   * empties the wrapper of focus, the list closes itself on the way out, and
   * the click that followed reopened what the user meant to shut.
   */
  function handleChipMousedown(e: MouseEvent): void {
    if (readonly) return;
    const target = e.target as HTMLElement | null;
    // The field's own text takes its presses: one places the caret, the other
    // filters the open list.
    if (target?.closest('.arg-input, .arg-popover')) return;
    e.preventDefault();
    chipEl?.querySelector<HTMLElement>('.arg-input, .arg-trigger')?.focus();
  }

  // Arriving at a field selects its contents so the next keystroke replaces
  // the old value instead of appending to it.
  $effect(() => {
    if (readonly) return;
    if (focused && inputRef && document.activeElement !== inputRef) {
      tick().then(() => {
        if (document.activeElement !== inputRef) inputRef?.focus();
        inputRef?.select();
      });
    }
  });

  function handleInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    onInput(target.value);
  }

  const label = $derived(arg.placeholder?.trim() || arg.name);
  // What the chip shows either way: the value the user entered or resumed,
  // else the hint. A password is never stashed, but mask it rather than
  // trust that, and it is what the field renders, so it is what to measure.
  const displayText = $derived(
    !value ? label : arg.type === 'password' ? '•'.repeat(value.length) : value,
  );

  /** Room past the last glyph for the caret to sit in. */
  const CARET_ROOM = 3;
  const MAX_FIELD_WIDTH = 240;
  let measureEl = $state<HTMLElement | null>(null);
  let fieldWidth = $state(0);
  // Both the preview and the live field take this width, so tabbing in swaps
  // one for the other without resizing the chip. Measured off a mirror rather
  // than `field-sizing: content`, which fits the box to the text alone and
  // leaves the caret to push the value out of view while typing. Reading
  // offsetWidth after render keeps it in sync without a ResizeObserver, as
  // SearchHeader does for the query the chips trail.
  $effect(() => {
    void displayText;
    if (!measureEl) return;
    fieldWidth = Math.min(MAX_FIELD_WIDTH, measureEl.offsetWidth + CARET_ROOM);
  });
</script>

<!-- data-no-focus-steal: the launcher hands focus back to the query on any
     click that isn't a text input, which would take the caret straight back
     out of the field just clicked, or empty a dropdown mid-pick. It sits on
     the chip rather than on the widget inside it because the opt-out is found
     by walking up: the trigger goes `pointer-events: none` in ghost mode, and
     the padding is the chip's own, so both land the click here. -->
<div
  bind:this={chipEl}
  class="arg-chip"
  class:arg-chip--ghost={readonly}
  class:arg-chip--needs-value={needsValue}
  class:arg-chip--dropdown={arg.type === 'dropdown'}
  data-focused={focused}
  data-no-focus-steal
  role="presentation"
  onclickcapture={onClick}
  onmousedown={handleChipMousedown}
>
  {#if arg.type === 'dropdown'}
    <ArgumentDropdownChip
      {arg}
      {value}
      {touched}
      {focused}
      {readonly}
      onSelect={onInput}
      onReset={() => onReset?.()}
      {onKeydown}
      {onFocus}
    />
  {:else}
    <span class="arg-measure-text" bind:this={measureEl} aria-hidden="true">{displayText}</span>
    {#if readonly}
      <!-- The hint row is a preview, so it renders as text. An <input> takes
           its width from the placeholder it first laid out with, and the row
           reuses its elements as the highlight moves, leaving the previous
           command's hint width and clipping this one. -->
      <span
        class="arg-ghost-text"
        class:arg-ghost-text--hint={!value}
        class:arg-ghost-text--seeded={value && !touched}
        style="width: {fieldWidth}px">{displayText}</span
      >
    {:else}
      <!-- Numbers render as text: selectionStart/setSelectionRange, which the
           arrow-key walk needs, throw InvalidStateError on type="number".
           Coercion and validation happen in commandArgumentsService. -->
      <Input
        textIntent="exact"
        bind:ref={inputRef}
        class="arg-input {value && !touched ? 'arg-input--seeded' : ''}"
        style="width: {fieldWidth}px"
        type={arg.type === 'password' ? 'password' : 'text'}
        placeholder={label}
        {value}
        unstyled
        data-arg-focus-target={focused || undefined}
        oninput={handleInput}
        onkeydown={onKeydown}
        onfocus={() => onFocus?.()}
        autocomplete="off"
        inputmode={arg.type === 'number' ? 'decimal' : undefined}
        aria-label={label}
        aria-required={arg.required ? 'true' : undefined}
      />
    {/if}
  {/if}
</div>

<style>
  /* The transparent resting border reserves the focus ring's box, so focusing
     a chip does not nudge the row. */
  .arg-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--bg-selected);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    padding: 3px var(--space-3);
    transition: border-color var(--transition-normal);
    min-width: 0;
  }
  /* The trigger carries the padding instead, so the whole chip surface opens
     the list rather than just the label. */
  .arg-chip--dropdown {
    padding: 0;
  }
  /* Focus is carried by the border and caret alone, so the fill stays put. */
  .arg-chip[data-focused='true'] {
    border-color: var(--text-tertiary);
  }
  /* A required field the user walked away from empty. Only ever shown once
     they have actually left it, so it reads as a consequence rather than a
     complaint about a field they were about to fill in. */
  .arg-chip--needs-value {
    border-color: color-mix(in srgb, var(--accent-danger) 45%, transparent);
    background: color-mix(in srgb, var(--accent-danger) 12%, var(--bg-selected));
  }
  /* The hint row itself is click-through so the gaps still focus the query;
     the chips opt back in, and a dropdown's trigger defers to the chip. */
  .arg-chip--ghost {
    cursor: pointer;
    pointer-events: auto;
  }
  .arg-chip--ghost :global(.arg-trigger) {
    cursor: pointer;
    pointer-events: none;
  }
  :global(.arg-input) {
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 500;
    font-family: var(--font-ui);
    padding: 0;
    min-width: 1ch;
    max-width: 240px;
  }
  :global(.arg-input:focus) {
    outline: none;
  }
  :global(.arg-input::placeholder) {
    color: var(--text-secondary);
  }
  /* A value the author supplied and the user has not agreed to. Grey like the
     placeholder, because neither is the user's — but underlined, because this
     one is a real value that will be sent. The placeholder is only a label. */
  :global(.arg-input--seeded),
  .arg-ghost-text--seeded {
    color: var(--text-secondary);
    text-decoration: underline dotted currentColor;
    text-underline-offset: 3px;
  }
  /* Mirrors the field's type so offsetWidth is the width the value renders
     at. Out of flow, so it cannot widen the chip it is measured inside. */
  .arg-measure-text {
    position: absolute;
    left: 0;
    top: 0;
    visibility: hidden;
    pointer-events: none;
    white-space: pre;
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    font-weight: 500;
  }
  /* Same type as the real field, so the preview and the chip the user tabs
     into are the same width. */
  .arg-ghost-text {
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 500;
    font-family: var(--font-ui);
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arg-ghost-text--hint {
    color: var(--text-secondary);
  }
</style>
