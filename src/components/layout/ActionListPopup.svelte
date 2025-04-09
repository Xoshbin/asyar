<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { logService } from '../../services/log/logService';
  import { actionService } from '../../services/action/actionService';
  import type { ApplicationAction } from '../../services/action/actionService';

  // Props
  export let availableActions: ApplicationAction[] = [];

  // Internal state
  let selectedIndex = 0;
  let actionButtons: HTMLButtonElement[] = [];
  let popupRef: HTMLDivElement;

  const dispatch = createEventDispatcher();

  // --- Keyboard Navigation & Selection ---

  function handleKeydown(event: KeyboardEvent) {
    if (availableActions.length === 0) return;

    const totalActions = availableActions.length;
    let preventDefault = true;

    switch (event.key) {
      case 'Escape':
        closePopup();
        break;
      case 'ArrowDown':
      case 'Tab': // Treat Tab like ArrowDown for simplicity within the popup
        if (event.key === 'Tab' && event.shiftKey) { // Handle Shift+Tab
             selectedIndex = (selectedIndex - 1 + totalActions) % totalActions;
        } else {
             selectedIndex = (selectedIndex + 1) % totalActions;
        }
        focusSelectedAction();
        break;
      case 'ArrowUp':
        selectedIndex = (selectedIndex - 1 + totalActions) % totalActions;
        focusSelectedAction();
        break;
      case 'Enter':
      case ' ': // Allow space to select
        if (selectedIndex >= 0 && selectedIndex < totalActions) {
          handleActionSelect(availableActions[selectedIndex].id);
        }
        break;
      default:
        preventDefault = false; // Don't prevent default for other keys
    }

    if (preventDefault) {
      event.preventDefault();
      event.stopPropagation(); // Stop propagation within the popup
    }
  }

  function focusSelectedAction() {
    // Use requestAnimationFrame to ensure DOM updates before focusing
    requestAnimationFrame(() => {
      actionButtons = Array.from(popupRef?.querySelectorAll('button[data-index]') || []);
      actionButtons[selectedIndex]?.focus();
    });
  }

  function handleActionSelect(actionId: string) {
    logService.debug(`[ActionListPopup] Action selected: ${actionId}`);
    closePopup(); // Close after selection
    try {
      actionService.executeAction(actionId);
    } catch (error) {
      logService.error(`[ActionListPopup] Failed to execute action ${actionId}: ${error}`);
    }
  }

  function closePopup() {
    logService.debug('[ActionListPopup] Closing popup');
    dispatch('close'); // Notify parent to close
  }

  // --- Lifecycle ---

  onMount(() => {
    // Focus the first item or the container when mounted
    selectedIndex = 0;
    setTimeout(() => { // Delay focus slightly
        popupRef?.focus(); // Focus container first for keydown listener
        focusSelectedAction(); // Then focus the first button
    }, 50);
    // Add keydown listener directly to the popup container
    popupRef?.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    popupRef?.removeEventListener('keydown', handleKeydown);
  });

</script>

<!-- Popup Container -->
<div
  bind:this={popupRef}
  class="action-list-popup absolute bottom-full right-0 mb-2 z-50 w-full max-w-sm"
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="action-list-heading"
>
  <!-- Make container focusable for key events -->
  <!-- Add accessibility -->
  <div
    class="overflow-hidden transition-all transform shadow-lg border border-[var(--border-color)] rounded-lg bg-[var(--bg-primary)]"
    style="max-height: 66vh;"
  >
    <!-- Optional Heading (for accessibility) -->
    <h2 id="action-list-heading" class="sr-only">Available Actions</h2>

    <div class="overflow-y-auto overscroll-contain p-2 flex-1" style="max-height: calc(66vh - 10px);">
      <div class="space-y-1">
        {#each availableActions as action, index}
          <button
            class="w-full text-left p-3 rounded border-none transition-colors flex items-center gap-3 {selectedIndex === index ? 'bg-[var(--bg-selected)] focus:outline-none ring-2 ring-[var(--focus-ring)] ring-offset-1 ring-offset-[var(--bg-primary)]' : 'hover:bg-[var(--bg-hover)] focus:outline-none focus:bg-[var(--bg-hover)]'}"
            on:click={() => handleActionSelect(action.id)}
            data-index={index}
            tabindex="-1"
          >
            <!-- Manage focus programmatically -->
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[var(--text-primary)] break-words">{action.label}</div>
              {#if action.description}
                <div class="text-sm text-[var(--text-secondary)] break-words">{action.description}</div>
              {/if}
            </div>
          </button>
        {:else}
          <div class="p-3 text-center text-sm text-[var(--text-secondary)]">No actions available.</div>
        {/each}
        <div class="h-1"></div> <!-- Padding at bottom -->
      </div>
    </div>
  </div>
</div>

<style>
  /* Ensure popup is positioned correctly relative to the bottom bar */
  .action-list-popup {
    /* Position adjustments might be needed depending on the final layout */
  }
  /* Improve focus visibility if needed */
  button:focus {
     /* outline: 2px solid var(--focus-ring); */
     /* outline-offset: 1px; */
  }
</style>
