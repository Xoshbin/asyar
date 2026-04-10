<script lang="ts">
  import { untrack } from 'svelte';
  import { useShortcutCapture } from '../../lib/useShortcutCapture.svelte';
  import { MODIFIER_ORDER } from '../../built-in-features/shortcuts/shortcutFormatter';

  let {
    modifier = $bindable(''),
    key = $bindable(''),
    placeholder = 'Click to record shortcut',
    disabled = false,
    autoRecord = false,
    onsave,
    oncancel,
    ondone,
    conflictChecker,
  }: {
    modifier?: string;
    key?: string;
    placeholder?: string;
    disabled?: boolean;
    autoRecord?: boolean;
    onsave?: (detail: { modifier: string; key: string }) => Promise<string | true>;
    oncancel?: () => void;
    ondone?: () => void;
    conflictChecker?: (shortcut: string) => Promise<{ name: string } | null>;
  } = $props();

  let buttonEl = $state<HTMLButtonElement>();

  const capture = useShortcutCapture({
    get conflictChecker() { return conflictChecker; },
    onCapture: async (result) => {
      const previousModifier = modifier;
      const previousKey = key;
      modifier = result.modifier;
      key = result.key;

      if (onsave) {
        const saveResult = await onsave(result);
        if (saveResult !== true) {
          modifier = previousModifier;
          key = previousKey;
        }
        return saveResult;
      }
      return true;
    },
    get onCancel() { return oncancel; },
    get onDone() { return ondone; },
  });

  function handleStartRecording() {
    if (disabled || capture.state.saveState === 'saving') return;
    capture.startRecording();
    buttonEl?.focus();
  }

  // Skip click-outside when autoRecord — modal handles dismissal
  $effect(() => {
    if (autoRecord || !capture.state.isRecording) return;

    function onClickOutside(event: MouseEvent) {
      if (buttonEl && !buttonEl.contains(event.target as Node)) {
        capture.stopRecording();
      }
    }

    window.addEventListener('mousedown', onClickOutside, true);
    return () => window.removeEventListener('mousedown', onClickOutside, true);
  });

  // untrack: avoid re-triggering when capture state changes; cleanup resumes shortcuts
  $effect(() => {
    if (autoRecord) {
      untrack(() => handleStartRecording());
    }
    return () => capture.stopRecording();
  });

  let idleChips = $derived.by(() => {
    if (modifier && key) {
      const mods = modifier.split('+')
        .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
        .map(m => capture.modifierSymbol(m));
      return [...mods, capture.displayKey(key)];
    }
    return [];
  });
</script>

<div
  class="shortcut-recorder"
  class:disabled
>
  <button
    bind:this={buttonEl}
    type="button"
    class="recorder-button"
    class:recording={capture.state.isRecording}
    class:error={capture.state.saveState === 'error'}
    class:success={capture.state.saveState === 'success'}
    onclick={handleStartRecording}
    disabled={disabled}
    tabindex={disabled ? -1 : 0}
    aria-label="Press keys to set shortcut"
  >
    {#if capture.state.isRecording}
      <div class="recorder-content">
        {#if capture.state.errorType === 'conflict' && capture.state.failedChips.length > 0}
          <div class="key-chips">
            {#each capture.state.failedChips as chip, i}
              {#if i === capture.state.failedChips.length - 1 && capture.state.failedChips.length > 1}<span class="chip-separator error-separator">+</span>{/if}
              <span class="chip error-chip">{chip}</span>
            {/each}
          </div>
        {:else if capture.state.rejectedKeys.length > 0 && capture.rejectedModifierChips.length > 0}
          <div class="key-chips">
            {#each capture.rejectedModifierChips as chip}
              <span class="chip recording-chip">{chip}</span>
            {/each}
            <span class="chip-separator {capture.hasValidRejectedKeys ? 'recording-separator' : 'example-separator'}">+</span>
            {#each capture.state.rejectedKeys.filter(k => !capture.state.invalidKeys.has(k)) as rk}
              <span class="chip recording-chip">{capture.displayKey(rk)}</span>
            {/each}
            {#each capture.state.rejectedKeys.filter(k => capture.state.invalidKeys.has(k)) as rk}
              <span class="chip error-chip">{capture.displayKey(rk)}</span>
            {/each}
          </div>
        {:else if capture.state.rejectedKeys.length > 0}
          <div class="key-chips">
            <span class="chip example-chip">⇧</span>
            <span class="chip example-chip">⌘</span>
            <span class="chip-separator example-separator">+</span>
            {#each capture.state.rejectedKeys.filter(k => !capture.state.invalidKeys.has(k)) as rk}
              <span class="chip recording-chip">{capture.displayKey(rk)}</span>
            {/each}
            {#each capture.state.rejectedKeys.filter(k => capture.state.invalidKeys.has(k)) as rk}
              <span class="chip error-chip">{capture.displayKey(rk)}</span>
            {/each}
          </div>
        {:else if capture.partialChips.length > 0}
          <div class="key-chips">
            {#each capture.partialChips as chip}
              <span class="chip recording-chip">{chip}</span>
            {/each}
            <span class="chip-separator example-separator">+</span>
            <span class="chip example-chip">B</span>
          </div>
        {:else}
          <div class="key-chips">
            <span class="example-label">e.g.</span>
            <span class="chip example-chip">⇧</span>
            <span class="chip example-chip">⌘</span>
            <span class="chip-separator example-separator">+</span>
            <span class="chip example-chip">B</span>
          </div>
        {/if}
      </div>
    {:else if capture.state.saveState === 'success'}
      <div class="recorder-content">
        <div class="key-chips">
          {#each idleChips as chip, i}
            {#if i === idleChips.length - 1 && idleChips.length > 1}<span class="chip-separator success-separator">+</span>{/if}
            <span class="chip success-chip">{chip}</span>
          {/each}
        </div>
      </div>
    {:else if capture.state.saveState === 'error' && capture.state.failedChips.length > 0}
      <div class="recorder-content">
        <div class="key-chips">
          {#each capture.state.failedChips as chip, i}
            {#if i === capture.state.failedChips.length - 1 && capture.state.failedChips.length > 1}<span class="chip-separator error-separator">+</span>{/if}
            <span class="chip error-chip">{chip}</span>
          {/each}
        </div>
      </div>
    {:else if capture.state.saveState === 'saving'}
      <div class="recorder-content">
        <span class="recording-label">Saving...</span>
      </div>
    {:else}
      <div class="recorder-content">
        {#if idleChips.length > 0}
          <div class="key-chips">
            {#each idleChips as chip, i}
              {#if i === idleChips.length - 1 && idleChips.length > 1}<span class="chip-separator">+</span>{/if}
              <span class="chip">{chip}</span>
            {/each}
          </div>
        {:else}
          <span class="placeholder-text">{placeholder}</span>
        {/if}
      </div>
    {/if}
  </button>

  <div class="message-slot" class:visible={capture.state.saveState === 'success' || (capture.state.errorType !== '' && capture.state.errorType !== 'no-modifier')}>
    {#if capture.state.saveState === 'success'}
      <div class="success-message">Saved</div>
    {:else if capture.state.errorType === 'invalid-key'}
      <div class="error-message">
        Invalid {capture.state.invalidKeys.size > 1 ? 'keys' : 'key'}
      </div>
    {:else if capture.state.errorType === 'conflict'}
      <div class="error-message">
        Already assigned to '{capture.state.conflictInfo}'
      </div>
    {:else if capture.state.errorType === 'generic'}
      <div class="error-message">{capture.state.errorMessage}</div>
    {/if}
  </div>
</div>

<style>
  .shortcut-recorder {
    position: relative;
    width: 100%;
  }

  .shortcut-recorder.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .recorder-button {
    width: 100%;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-6);
    cursor: pointer;
    transition: all var(--transition-normal);
    min-height: var(--space-11);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .recorder-button:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .recorder-button:focus {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 50%, transparent);
  }

  .recorder-button.recording {
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-primary));
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 25%, transparent);
  }

  .recorder-button.error {
    background: color-mix(in srgb, var(--accent-danger) 8%, var(--bg-primary));
    border-color: var(--accent-danger);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-danger) 25%, transparent);
  }

  .recorder-button.success {
    background: color-mix(in srgb, var(--accent-success) 8%, var(--bg-primary));
    border-color: var(--accent-success);
  }

  .recorder-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
  }

  .key-chips {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .chip-separator {
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    font-weight: 600;
  }

  .chip-separator.recording-separator {
    color: var(--accent-primary);
  }

  .chip-separator.success-separator {
    color: var(--accent-success);
  }

  .chip-separator.error-separator {
    color: var(--accent-danger);
  }

  .chip-separator.example-separator {
    color: var(--text-tertiary);
  }

  .chip {
    padding: var(--space-1) var(--space-3);
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: var(--font-size-md);
    font-weight: 600;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-color);
  }

  .chip.recording-chip {
    background: color-mix(in srgb, var(--accent-primary) 15%, var(--bg-hover));
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .chip.success-chip {
    background: color-mix(in srgb, var(--accent-success) 15%, var(--bg-hover));
    border-color: var(--accent-success);
    color: var(--accent-success);
  }

  .chip.example-chip {
    background: var(--bg-hover);
    color: var(--text-tertiary);
    border-color: var(--border-color);
  }

  .chip.error-chip {
    background: color-mix(in srgb, var(--accent-danger) 15%, var(--bg-hover));
    border-color: var(--accent-danger);
    color: var(--accent-danger);
  }

  .example-label {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }

  .recording-label {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  .placeholder-text {
    color: var(--text-tertiary);
    font-size: var(--font-size-md);
  }

  .message-slot {
    height: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: height var(--transition-normal), opacity var(--transition-normal);
  }

  .message-slot.visible {
    height: var(--space-10);
    opacity: 1;
  }

  .success-message {
    color: var(--text-primary);
    font-size: var(--font-size-base);
    text-align: center;
  }

  .error-message {
    color: var(--accent-danger);
    font-size: var(--font-size-base);
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
  }
</style>
