<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { shortcutService } from './shortcutService';
  import { shortcutStore } from './shortcutStore.svelte';
  import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
  import { MODIFIER_KEYS, fromKeyboardEvent, toDisplayString, isValid } from './shortcutFormatter';

  let { events }: {
    events: {
      capture: (shortcut: string) => void;
      cancel: () => void;
      excludeObjectId?: string;
    }
  } = $props();

  let capturedShortcut = $state('');
  let partialModifiers = $state(new Set<string>());
  let conflictWarning = $state<string | null>(null);
  let validationError = $state<string | null>(null);

  // DOM key name 'Meta' maps to storage name 'Super' in our format
  function domKeyToStorageKey(k: string): string {
    return k === 'Meta' ? 'Super' : k;
  }

  function getDisplayValue(): string {
    if (capturedShortcut) return toDisplayString(capturedShortcut);
    if (partialModifiers.size > 0) {
      return [...partialModifiers].map(m => toDisplayString(domKeyToStorageKey(m) + '+x').replace('x', '')).join('') + '…';
    }
    return '';
  }

  let displayValue = $derived(getDisplayValue());
  let hasInput = $derived(!!capturedShortcut || partialModifiers.size > 0);

  async function captureKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      events.cancel();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.type === 'keydown') {
      if (e.key === 'Enter') {
        if (capturedShortcut && !conflictWarning && !validationError) {
          e.preventDefault();
          e.stopPropagation();
          events.capture(capturedShortcut);
        }
        return;
      }

      // Ignore tabbing so they can tab to buttons if they want (or maybe we don't care, but better to preventDefault only for actual capture logic)
      if (e.key === 'Tab') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (MODIFIER_KEYS.includes(e.key)) {
        partialModifiers.add(e.key);
        partialModifiers = partialModifiers;
        validationError = null;
        return;
      }

      const shortcut = fromKeyboardEvent(e);
      if (!shortcut) return;

      if (!isValid(shortcut)) {
        validationError = 'Shortcut must include at least one modifier (⌘ ⌃ ⌥ ⇧)';
        return;
      }

      capturedShortcut = shortcut;
      const conflict = await shortcutService.isConflict(shortcut, events.excludeObjectId);
      conflictWarning = conflict ? `Conflicts with: ${conflict.itemName}` : null;
      validationError = null;

    } else if (e.type === 'keyup') {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_KEYS.includes(e.key)) {
        partialModifiers.delete(e.key);
        partialModifiers = partialModifiers;
      }
      // We don't clear capturedShortcut on keyup anymore.
      // Wait for explicit Save button click or Enter keypress.
    }
  }

  onMount(() => {
    // Unregister OS-level shortcuts so their key combos flow through to the browser.
    // Without this, macOS CGEventTap consumes registered key combos before the WebView sees them.
    invoke('pause_user_shortcuts').catch(console.error);
    shortcutStore.isCapturing = true;
    extensionIframeManager.hasInputFocus = true;
    window.addEventListener('keydown', captureKey, true);
    window.addEventListener('keyup', captureKey, true);
  });

  onDestroy(() => {
    // Re-register OS-level shortcuts now that capture is done.
    invoke('resume_user_shortcuts').catch(console.error);
    shortcutStore.isCapturing = false;
    extensionIframeManager.hasInputFocus = false;
    window.removeEventListener('keydown', captureKey, true);
    window.removeEventListener('keyup', captureKey, true);
  });
</script>

<div class="capture-overlay" role="dialog">
  <div class="capture-box">
    <h3>Assign Shortcut</h3>
    <p>Press the combination you want to use</p>

    <!-- Matches ShortcutRecorder visual style -->
    <div class="keycatcher" class:active={hasInput} class:conflict={!!conflictWarning}>
      <div class="recorder-inner">
        <span class="recorder-text">
          {#if capturedShortcut}
            <!-- chips on the right will show the full shortcut; left shows nothing -->
          {:else if partialModifiers.size > 0}
            {displayValue}
          {:else}
            Press keys now…
          {/if}
        </span>
        {#if capturedShortcut}
          <div class="key-chips">
            {#each capturedShortcut.split('+') as part}
              <span class="chip">{toDisplayString(part)}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if conflictWarning}
      <div class="message warning">⚠ {conflictWarning}</div>
    {/if}
    {#if validationError}
      <div class="message error">{validationError}</div>
    {/if}

    <div class="hint">Press <kbd class="esc-key">Esc</kbd> to cancel</div>

    <div class="actions">
      <button class="btn cancel" on:click={events.cancel}>Cancel</button>
      <button class="btn save" class:disabled={!capturedShortcut || !!conflictWarning || !!validationError} on:click={() => {
        if (capturedShortcut && !conflictWarning && !validationError) {
          events.capture(capturedShortcut);
        }
      }}>Save</button>
    </div>
  </div>
</div>

<style>
  .capture-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .capture-box {
    background: var(--bg-popup);
    padding: 28px 28px 20px;
    border-radius: var(--border-radius-xl);
    box-shadow: 0 8px 32px var(--shadow-color), 0 0 0 1px var(--border-color);
    text-align: center;
    color: var(--text-primary);
    min-width: 340px;
  }

  h3 {
    margin: 0 0 4px;
    font-weight: 600;
    font-size: 15px;
  }

  p {
    margin: 0 0 20px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  /* Matches ShortcutRecorder's visual style */
  .keycatcher {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    padding: 12px 16px;
    transition: border-color 0.15s, box-shadow 0.15s;
    margin-bottom: 12px;
    font-weight: 600;
  }

  .keycatcher.active {
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-primary));
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 25%, transparent);
  }

  .keycatcher.conflict {
    border-color: var(--accent-warning);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-warning) 25%, transparent);
  }

  .recorder-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .recorder-text {
    color: var(--text-primary);
    font-size: 14px;
  }

  .key-chips {
    display: flex;
    gap: 4px;
  }

  .chip {
    padding: 2px 8px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 13px;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .message {
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--border-radius-md);
    margin-bottom: 10px;
    text-align: left;
  }

  .message.warning {
    color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
  }

  .message.error {
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }

  .hint {
    color: var(--text-tertiary);
    font-size: 12px;
    margin-top: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .esc-key {
    font-size: 11px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 6px;
    font-family: inherit;
    color: var(--text-secondary);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
    justify-content: flex-end;
  }

  .btn {
    padding: 6px 14px;
    border-radius: var(--border-radius-md);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.2s;
  }

  .btn.cancel {
    background: transparent;
    color: var(--text-secondary);
    border-color: var(--border-color);
  }

  .btn.cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn.save {
    background: var(--accent-primary);
    color: white;
  }

  .btn.save:hover:not(.disabled) {
    filter: brightness(1.1);
  }

  .btn.save.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
