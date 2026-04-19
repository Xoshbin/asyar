<script lang="ts">
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import CommandArgInput from './CommandArgInput.svelte';
  import type { ActiveArgumentMode } from '../../services/search/commandArgumentsService.svelte';

  let {
    active,
    canSubmit,
    onValueChange,
    onFocusField,
    onNext,
    onPrev,
    onSubmit,
    onExit,
  }: {
    active: ActiveArgumentMode;
    canSubmit: boolean;
    onValueChange: (name: string, value: string) => void;
    onFocusField: (idx: number) => void;
    onNext: () => void;
    onPrev: () => void;
    onSubmit: () => void;
    onExit: () => void;
  } = $props();

  function handleFieldKeydown(idx: number, e: KeyboardEvent) {
    const atFirst = idx === 0;
    const isEmpty = (active.values[active.args[idx].name] ?? '') === '';

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+Tab at the first field exits argument mode — symmetric with
        // Backspace-on-empty and keeps users from getting "stuck" at idx=0.
        if (atFirst) onExit();
        else onPrev();
      } else {
        onNext();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) onSubmit();
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

<div class="argument-chip-row">
  <span class="command-chip">
    <span class="chip-icon">
      {#if active.icon}
        {#if isBuiltInIcon(active.icon)}
          <Icon name={getBuiltInIconName(active.icon)} size={13} />
        {:else if isIconImage(active.icon)}
          <img src={active.icon} alt="" class="w-4 h-4 object-contain" />
        {:else}
          {active.icon}
        {/if}
      {/if}
    </span>
    <span class="chip-name">{active.title}</span>
    <button
      type="button"
      class="chip-dismiss"
      onclick={onExit}
      tabindex="-1"
      aria-label="Exit argument mode"
    >
      ×
    </button>
  </span>

  <div class="arg-fields">
    {#each active.args as arg, idx}
      <CommandArgInput
        {arg}
        value={active.values[arg.name] ?? ''}
        focused={idx === active.currentFieldIdx}
        onInput={(v) => onValueChange(arg.name, v)}
        onKeydown={(e) => handleFieldKeydown(idx, e)}
      />
      <!-- focus delegation when user clicks a chip -->
      <button
        type="button"
        class="field-focus-proxy"
        onclick={() => onFocusField(idx)}
        tabindex="-1"
        aria-hidden="true"
      ></button>
    {/each}
  </div>

  <span class="submit-hint">
    <KeyboardHint keys="Enter" />
    <span class="hint-label">{canSubmit ? 'Run' : 'Fill required fields'}</span>
  </span>
</div>

<style>
  .argument-chip-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .command-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--accent-primary);
    color: white;
    border-radius: var(--radius-md);
    padding: 3px 4px 3px var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
    box-shadow: var(--shadow-xs);
  }
  .chip-icon {
    font-size: var(--font-size-md);
    display: inline-flex;
    align-items: center;
  }
  .chip-name {
    font-size: var(--font-size-sm);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-dismiss {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    padding: 0 var(--space-1);
    font-size: var(--font-size-lg);
    line-height: 1;
    display: flex;
    align-items: center;
    border-radius: var(--radius-xs);
    margin-left: 2px;
  }
  .chip-dismiss:hover {
    color: white;
    background: rgba(255, 255, 255, 0.15);
  }
  .arg-fields {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  .field-focus-proxy {
    display: none;
  }
  .submit-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    flex-shrink: 0;
    user-select: none;
  }
  .hint-label {
    font-size: var(--font-size-sm);
  }
</style>
