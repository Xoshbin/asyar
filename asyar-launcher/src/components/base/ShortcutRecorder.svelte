<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { LogService } from '../../services/logService';
  
  // Props
  export let modifier = "";
  export let key = "";
  export let placeholder = "Click to record shortcut";
  export let disabled = false;
  
  // State
  let isRecording = false;
  let errorMessage = "";
  
  const dispatch = createEventDispatcher();
  
  // Supported modifier keys
  const validModifiers = ['Alt', 'Ctrl', 'Shift', 'Super', 'Meta', 'Command'];
  
  // Helper to determine if a key is a modifier
  function isModifierKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return lowerKey === 'alt' || lowerKey === 'control' || lowerKey === 'ctrl' || 
           lowerKey === 'shift' || lowerKey === 'meta' || lowerKey === 'command' || 
           lowerKey === 'super';
  }
  
  // Start recording when the component is clicked
  function startRecording() {
    if (disabled) return;
    isRecording = true;
    errorMessage = "";
  }
  
  // Handle keydown events to capture keys
  function handleKeyDown(event: KeyboardEvent) {
    if (!isRecording) return;
    
    // Prevent default behavior and stop propagation
    event.preventDefault();
    event.stopPropagation();
    
    // Get the actual key (not the modifier)
    let capturedKey = event.key;
        
    // Explicit check for space key
    if (capturedKey === ' ' || capturedKey === 'Spacebar' || event.keyCode === 32) {
      capturedKey = 'Space';  // Force it to be "Space" string
    } 
    // For single character keys, convert to uppercase
    else if (capturedKey.length === 1) {
      capturedKey = capturedKey.toUpperCase();
    }
    
    // Get the modifier
    let capturedModifier = '';
    
    if (event.altKey) capturedModifier = 'Alt';
    else if (event.ctrlKey) capturedModifier = 'Ctrl';
    else if (event.shiftKey) capturedModifier = 'Shift';
    // Handle different platform-specific naming for the cmd/super key
    else if (event.metaKey) capturedModifier = 'Super';
    
    // Don't allow using just modifier keys or using a modifier as the main key
    if (isModifierKey(capturedKey)) {
      errorMessage = "Please press a non-modifier key while holding a modifier";
      return;
    }
    
    // Don't allow using no modifiers
    if (!capturedModifier) {
      errorMessage = "Please include a modifier key (Alt, Ctrl, Shift, or Super)";
      return;
    }
    
    console.log(`Final captured values: Modifier=${capturedModifier}, Key=${capturedKey}`);
    
    // Update the values using a timeout to ensure they're updated after the event handling
    setTimeout(() => {
      modifier = capturedModifier;
      key = capturedKey;
      
      // Dispatch the event with the new values
      dispatch('change', { modifier: capturedModifier, key: capturedKey });
      
      // Stop recording
      isRecording = false;
    }, 0);
  }
  
  // Force the space key to be recognized
  function handleKeyPress(event: KeyboardEvent) {
    if (!isRecording) return;
    
    // Explicitly check for space key
    if (event.key === ' ' || event.keyCode === 32) {
      event.preventDefault();
      event.stopPropagation();
      
      // Additional check - if this handler triggered for space but keydown didn't set it properly
      if (event.key === ' ') {
        LogService.info("Space detected in keypress handler");
      }
    }
  }
  
  // Handle keyup events
  function handleKeyUp(event: KeyboardEvent) {
    // Special handling for space key in keyup
    if (isRecording && (event.key === ' ' || event.keyCode === 32)) {
      LogService.info("Space key detected in keyup");
    }
    
    // Keep error displayed for a bit for readability
    if (errorMessage) {
      setTimeout(() => {
        errorMessage = "";
      }, 2000);
    }
  }
  
  // Handle blur events to stop recording
  function handleBlur() {
    isRecording = false;
    errorMessage = "";
  }
  
  // Format the display
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
