<script lang="ts">
  import { tick } from 'svelte';
  import CommandArgInput from './CommandArgInput.svelte';
  import {
    fieldNeedsValue,
    type ActiveArgumentMode,
  } from '../../services/search/commandArgumentsService.svelte';

  let {
    active,
    onValueChange,
    onValueReset,
    onFocusField,
    onNext,
    onPrev,
    onSubmit,
    onExit,
    onMoveToQuery,
  }: {
    active: ActiveArgumentMode;
    onValueChange: (name: string, value: string) => void;
    /** A dropdown put back to its seeded value, and back to untouched. */
    onValueReset: (name: string) => void;
    /**
     * Which field the row is on. Driven off each field's own focus event, so
     * the walk stays with the caret however it moved: a click into a chip, a
     * dropdown handing focus back as its list closes, or the keyboard.
     */
    onFocusField: (idx: number) => void;
    onNext: () => void;
    onPrev: () => void;
    onSubmit: () => void;
    onExit: () => void;
    /** Arrowing or tabbing off either end lands back in the search query. */
    onMoveToQuery: () => void;
  } = $props();

  // Read out of the DOM rather than collecting per-field bindings: binding
  // element refs into a reactive array writes state mid-render.
  let rowEl = $state<HTMLElement | null>(null);

  // A dropdown's focusable element is its trigger button, not an input.
  function fieldEl(idx: number): HTMLElement | null {
    return rowEl?.querySelectorAll<HTMLElement>('.arg-input, .arg-trigger')[idx] ?? null;
  }

  /**
   * Focus a field and select its contents. Exported so SearchHeader can
   * enter the first field the same way when the query is arrowed off.
   *
   * The index is reported up front rather than left to the field's own focus
   * handler, so the ring lands with the value already selected instead of a
   * frame behind it.
   */
  export function focusFieldSelected(idx: number): void {
    if (idx < 0 || idx >= active.args.length) return;
    onFocusField(idx);
    void tick().then(() => {
      const el = fieldEl(idx);
      if (!el) return;
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    });
  }

  /**
   * Left and Right are deliberately asymmetric. Left steps field to field,
   * selecting each. Right is what drops into a field, collapsing the
   * selection onto its trailing edge first, so crossing a filled field
   * rightwards takes two presses. Neither wraps.
   */
  function handleArrow(idx: number, e: KeyboardEvent): boolean {
    // A dropdown chip has no caret to cross, so one press leaves it either way.
    if (active.args[idx]?.type === 'dropdown') {
      e.preventDefault();
      if (e.key === 'ArrowRight') {
        if (idx < active.args.length - 1) focusFieldSelected(idx + 1);
      } else if (idx > 0) {
        focusFieldSelected(idx - 1);
      } else {
        onMoveToQuery();
      }
      return true;
    }

    const el = e.currentTarget ?? e.target;
    if (!(el instanceof HTMLInputElement)) return false;

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = end > start;

    if (e.key === 'ArrowRight') {
      if (selected) {
        e.preventDefault();
        el.setSelectionRange(end, end);
        return true;
      }
      if (start < el.value.length) return false;
      e.preventDefault();
      if (idx < active.args.length - 1) focusFieldSelected(idx + 1);
      return true;
    }

    if (!selected && start > 0) return false;
    e.preventDefault();
    if (idx > 0) focusFieldSelected(idx - 1);
    else onMoveToQuery();
    return true;
  }

  function handleFieldKeydown(idx: number, e: KeyboardEvent) {
    const atFirst = idx === 0;
    const isEmpty = (active.values[active.args[idx].name] ?? '') === '';

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      handleArrow(idx, e);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // The query is the slot before the first field and after the last, so
      // Tab is one ring over everything rather than a loop inside the chips.
      // With a single argument that is the difference between Tab doing
      // nothing and Tab toggling between the query and the field.
      if (e.shiftKey) {
        if (atFirst) onMoveToQuery();
        else onPrev();
      } else {
        if (idx === active.args.length - 1) onMoveToQuery();
        else onNext();
      }
      return;
    }
    if (e.key === 'Enter') {
      // submit() decides whether this runs; gating here would swallow the
      // refusal and leave nothing to explain it.
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onExit();
      return;
    }
    if (e.key === 'Backspace' && atFirst && isEmpty) {
      e.preventDefault();
      onExit();
      return;
    }
  }
</script>

<div class="arg-fields" bind:this={rowEl}>
  {#each active.args as arg, idx}
    <CommandArgInput
      {arg}
      value={active.values[arg.name] ?? ''}
      focused={idx === active.currentFieldIdx}
      needsValue={fieldNeedsValue(active, idx)}
      touched={active.edited.has(arg.name)}
      onInput={(v) => onValueChange(arg.name, v)}
      onReset={() => onValueReset(arg.name)}
      onKeydown={(e) => handleFieldKeydown(idx, e)}
      onFocus={() => onFocusField(idx)}
    />
  {/each}
</div>

<style>
  .arg-fields {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
</style>
