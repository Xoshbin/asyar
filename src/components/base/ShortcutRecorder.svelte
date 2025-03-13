<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { logService } from '../../services/logService';
  
  // Component props
  export let modifier = "";
  export let key = "";
  export let placeholder = "Click to record shortcut";
  export let disabled = false;
  
  // Internal state
  let isRecording = false;
  let errorMessage = "";
  
  // Event dispatcher
  const dispatch = createEventDispatcher();
  
  // Constants
  const VALID_MODIFIERS = ['Alt', 'Ctrl', 'Shift', 'Super', 'Meta', 'Command'];
  
  /**
   * Check if a key is a modifier key
   */
  function isModifierKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return ['alt', 'control', 'ctrl', 'shift', 'meta', 'command', 'super'].includes(lowerKey);
  }
  
  /**
   * Start recording when the component is clicked
   */
  function startRecording() {
    if (disabled) return;
    isRecording = true;
    errorMessage = "";
  }
  
  /**
   * Handle keydown events to capture keys
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (!isRecording) return;
    
    // Prevent default behavior and stop propagation
    event.preventDefault();
    event.stopPropagation();
    
    // Get the actual key (not the modifier)
    let capturedKey = event.key;
        
    // Handle special keys
    if (capturedKey === ' ' || capturedKey === 'Spacebar' || event.keyCode === 32) {
      capturedKey = 'Space';
    } else if (capturedKey.length === 1) {
      // For single character keys, convert to uppercase
      capturedKey = capturedKey.toUpperCase();
    }
    
    // Get the modifier
    let capturedModifier = '';
    
    if (event.altKey) capturedModifier = 'Alt';
    else if (event.ctrlKey) capturedModifier = 'Ctrl';
    else if (event.shiftKey) capturedModifier = 'Shift';
    else if (event.metaKey) capturedModifier = 'Super';
    
    // Validate input
    if (isModifierKey(capturedKey)) {
      errorMessage = "Please press a non-modifier key while holding a modifier";
      return;
    }
    
    if (!capturedModifier) {
      errorMessage = "Please include a modifier key (Alt, Ctrl, Shift, or Super)";
      return;
    }
    
    // Update values after validation passes
    setTimeout(() => {
      modifier = capturedModifier;
      key = capturedKey;
      
      // Dispatch the change event
      dispatch('change', { modifier: capturedModifier, key: capturedKey });
      
      // Stop recording
      isRecording = false;
    }, 0);
  }
  
  /**
   * Handle keypress events (specifically for space key)
   */
  function handleKeyPress(event: KeyboardEvent) {
    if (!isRecording) return;
    
    if (event.key === ' ' || event.keyCode === 32) {
      event.preventDefault();
      event.stopPropagation();
      
      if (event.key === ' ') {
        logService.info("Space detected in keypress handler");
      }
    }
  }
  
  /**
   * Handle keyup events
   */
  function handleKeyUp(event: KeyboardEvent) {
    // Special handling for space key
    if (isRecording && (event.key === ' ' || event.keyCode === 32)) {
      logService.info("Space key detected in keyup");
    }
    
    // Auto-hide error message after a delay
    if (errorMessage) {
      setTimeout(() => {
        errorMessage = "";
      }, 2000);
    }
  }
  
  /**
   * Handle blur events
   */
  function handleBlur() {
    isRecording = false;
    errorMessage = "";
  }
  
  // Format the display text
  $: displayText = modifier && key 
    ? `${modifier} + ${key}` 
    : placeholder;
</script>

<div 
  class="keycatcher relative w-full {disabled ? 'opacity-60 cursor-not-allowed' : ''}"
  class:active={isRecording}
>
  <button
    type="button"
    class="w-full text-left bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-150"
    class:recording={isRecording}
    on:click={startRecording}
    on:keydown={handleKeyDown}
    on:keypress={handleKeyPress}
    on:keyup={handleKeyUp}
    on:blur={handleBlur}
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
