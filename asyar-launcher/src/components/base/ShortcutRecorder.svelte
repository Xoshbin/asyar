<script lang="ts">
  import { logService } from '../../services/log/logService';

  let {
    modifier = $bindable(""),
    key = $bindable(""),
    placeholder = "Click to record shortcut",
    disabled = false,
    autoStart = false,
    onchange,
    oncancel
  }: {
    modifier?: string;
    key?: string;
    placeholder?: string;
    disabled?: boolean;
    autoStart?: boolean;
    onchange?: (detail: { modifier: string; key: string }) => void;
    oncancel?: () => void;
  } = $props();

  let isRecording = $state(false);
  let errorMessage = $state("");
  let buttonEl = $state<HTMLButtonElement>();

  const VALID_MODIFIERS = ['Alt', 'Ctrl', 'Shift', 'Super', 'Meta', 'Command'];

  function isModifierKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return ['alt', 'control', 'ctrl', 'shift', 'meta', 'command', 'super'].includes(lowerKey);
  }

  export function startRecording() {
    if (disabled) return;
    isRecording = true;
    errorMessage = "";
    buttonEl?.focus();
  }

  $effect(() => {
    if (autoStart) startRecording();
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (!isRecording) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      isRecording = false;
      errorMessage = '';
      oncancel?.();
      return;
    }

    let capturedKey = event.key;
    if (capturedKey === ' ' || capturedKey === 'Spacebar' || event.keyCode === 32) {
      capturedKey = 'Space';
    } else if (capturedKey.length === 1) {
      capturedKey = capturedKey.toUpperCase();
    }

    let capturedModifier = '';
    if (event.altKey) capturedModifier = 'Alt';
    else if (event.ctrlKey) capturedModifier = 'Ctrl';
    else if (event.shiftKey) capturedModifier = 'Shift';
    else if (event.metaKey) capturedModifier = 'Super';

    if (isModifierKey(capturedKey)) {
      errorMessage = "Please press a non-modifier key while holding a modifier";
      return;
    }

    if (!capturedModifier) {
      errorMessage = "Please include a modifier key (Alt, Ctrl, Shift, or Super)";
      return;
    }

    setTimeout(() => {
      modifier = capturedModifier;
      key = capturedKey;
      onchange?.({ modifier: capturedModifier, key: capturedKey });
      isRecording = false;
    }, 0);
  }

  function handleKeyPress(event: KeyboardEvent) {
    if (!isRecording) return;
    if (event.key === ' ' || event.keyCode === 32) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (errorMessage) {
      setTimeout(() => {
        errorMessage = "";
      }, 2000);
    }
  }

  function handleBlur() {
    isRecording = false;
    errorMessage = "";
  }

  let displayText = $derived(modifier && key ? `${modifier} + ${key}` : placeholder);
</script>

<div
  class="keycatcher relative w-full {disabled ? 'opacity-60 cursor-not-allowed' : ''}"
  class:active={isRecording}
>
  <button
    bind:this={buttonEl}
    type="button"
    class="w-full text-left bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-150"
    class:recording={isRecording}
    onclick={startRecording}
    onkeydown={handleKeyDown}
    onkeypress={handleKeyPress}
    onkeyup={handleKeyUp}
    onblur={handleBlur}
    disabled={disabled}
    tabindex={disabled ? -1 : 0}
    aria-label="Press keys to set shortcut"
  >
    <div class="flex items-center justify-between">
      <span class="text-[var(--text-primary)]">
        {isRecording ? 'Press keys now...' : displayText}
      </span>

      {#if !isRecording && (modifier && key)}
        <div class="flex space-x-1">
          {#each [modifier, key] as part}
            <span class="px-2 py-0.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm rounded border border-[var(--border-color)]">{part}</span>
          {/each}
        </div>
      {/if}
    </div>
  </button>

  {#if errorMessage}
    <div class="text-red-500 text-sm mt-1">{errorMessage}</div>
  {/if}

  {#if isRecording}
    <div class="absolute inset-0 bg-blue-500 bg-opacity-10 pointer-events-none rounded-lg border-2 border-blue-500 animate-pulse"></div>
  {/if}
</div>

<style>
  .keycatcher.active button {
    background-color: var(--bg-selected);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
  }

  button.recording {
    font-weight: 600;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.2; }
  }

  .animate-pulse {
    animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
