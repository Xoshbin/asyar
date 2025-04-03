<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { logService } from '../../services/log/logService';
  import { actionService, actionStore } from '../../services/action/actionService';
  import type { ApplicationAction } from '../../services/action/actionService';
  import { ActionContext } from 'asyar-api'; // Import enum from API
  import { isActionDrawerOpen, selectedActionIndex } from '../../services/ui/uiStateStore';
  import { activeView } from '../../services/extension/extensionManager';
  import ActionPanel from './ActionPanel.svelte';

  let actionDrawerRef: HTMLElement;
  let actionButtons: HTMLButtonElement[] = [];
  let availableActions: ApplicationAction[] = [];

  // Define the actions for the bottom ActionPanel
  let actionPanelActions = [{ id: 'actions', label: '⌘ K Actions', icon: '' }];

  // Subscribe to action store updates
  const unsubscribeActions = actionStore.subscribe((actions: ApplicationAction[]) => {
    availableActions = actions;
    if ($isActionDrawerOpen) $selectedActionIndex = 0; // Reset index when actions change while open
  });

  // --- Action Drawer Functions (Moved from +page.svelte) ---

  function handleActionPanelAction(event: CustomEvent<{ actionId: string }>) {
    if (event.detail.actionId === 'actions') toggleActionDrawer();
  }

  function toggleActionDrawer() {
    $isActionDrawerOpen = !$isActionDrawerOpen; // Update store value
    if ($isActionDrawerOpen) {
      document.body.classList.add('action-drawer-open');

      // Reverted: Set context based only on activeView
      const contextToSet = $activeView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE;
      logService.debug(`Setting action context to: ${contextToSet}`);
      actionService.setContext(contextToSet);
      // --- End Context Setting ---

      $selectedActionIndex = 0; // Reset index when opening
      document.addEventListener('keydown', captureAllKeydowns, true);
      setTimeout(() => {
        actionButtons = Array.from(actionDrawerRef?.querySelectorAll('button') || []);
        actionButtons[0]?.focus() || actionDrawerRef?.focus();
      }, 50);
    } else {
      document.body.classList.remove('action-drawer-open');
      document.removeEventListener('keydown', captureAllKeydowns, true);
      // Reset context when closing - back to CORE or EXTENSION_VIEW
      const resetContext = $activeView ? ActionContext.EXTENSION_VIEW : ActionContext.CORE;
      logService.debug(`Resetting action context to: ${resetContext}`);
      actionService.setContext(resetContext);
      // Note: Focus restoration to search input should happen in the parent component (+page.svelte)
    }
  }

 function captureAllKeydowns(event: KeyboardEvent) {
     if (event.key === 'Escape'){
         event.preventDefault();
         event.stopPropagation();
         handleActionKeydown(event); // Let handler manage closing
         return;
     }
    // Only capture keys if the drawer is open
    if ($isActionDrawerOpen && ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' '].includes(event.key)) {
      event.stopPropagation();
      handleActionKeydown(event);
    } else if ($isActionDrawerOpen) {
       event.stopPropagation();
    }
  }


  function handleActionKeydown(event: KeyboardEvent) {
    if (!$isActionDrawerOpen) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        toggleActionDrawer();
        return;
    }

    if (availableActions.length === 0) return;

    const totalActions = availableActions.length;
    let preventDefault = true;

    switch (event.key) {
      case 'ArrowDown':
      case 'Tab':
        if (event.key === 'Tab' && event.shiftKey) {
             $selectedActionIndex = ($selectedActionIndex - 1 + totalActions) % totalActions;
        } else {
             $selectedActionIndex = ($selectedActionIndex + 1) % totalActions;
        }
        focusSelectedAction();
        break;
      case 'ArrowUp':
        $selectedActionIndex = ($selectedActionIndex - 1 + totalActions) % totalActions;
        focusSelectedAction();
        break;
      case 'Enter':
      case ' ':
        if ($selectedActionIndex >= 0 && $selectedActionIndex < totalActions) {
          handleActionSelect(availableActions[$selectedActionIndex].id);
        }
        break;
      default:
         preventDefault = false;
    }

    if(preventDefault) {
        event.preventDefault();
    }
  }


  function focusSelectedAction() {
    setTimeout(() => {
      actionButtons = Array.from(actionDrawerRef?.querySelectorAll('button') || []);
      actionButtons[$selectedActionIndex]?.focus();
    }, 10);
  }

  function handleActionSelect(actionId: string) {
    logService.debug(`Action selected: ${actionId}`);
    toggleActionDrawer(); // Close drawer
    try {
      // Focus restoration is handled by the parent component
      actionService.executeAction(actionId);
    } catch (error) {
      logService.error(`Failed to execute action ${actionId}: ${error}`);
     }
   }

   // Export the toggle function so parent can call it
   export function toggle() {
       toggleActionDrawer();
   }

  // --- Lifecycle ---
  onMount(() => {
    // Add listener only if drawer is already open on mount (unlikely but safe)
    if ($isActionDrawerOpen) {
        document.addEventListener('keydown', captureAllKeydowns, true);
    }
  });

   onDestroy(() => {
     unsubscribeActions();
     // Clean up listener regardless of drawer state when component is destroyed
     document.body.classList.remove('action-drawer-open'); // Safe to call even if class isn't present
     document.removeEventListener('keydown', captureAllKeydowns, true); // Safe to call even if listener wasn't added
   });

</script>

<!-- Action Drawer Markup -->
{#if $isActionDrawerOpen}
  <div bind:this={actionDrawerRef} class="action-drawer fixed bottom-14 right-0 z-50 flex justify-end pr-4" tabindex="-1">
     <div
       class="w-full max-w-sm overflow-hidden transition-all transform shadow-lg border border-[var(--border-color)] rounded-lg mr-0 ml-4 mb-2"
       role="dialog" aria-modal="true" style="max-height: 66vh;"
     >
         <div class="overflow-y-auto overscroll-contain p-2 flex-1" style="max-height: calc(66vh - 0px);">
           <div class="space-y-1">
             {#each availableActions as action, index}
               <button
                 class="w-full text-left p-3 rounded border-none transition-colors flex items-center gap-3 {$selectedActionIndex === index ? 'bg-[var(--bg-selected)] focus:outline-none' : 'hover:bg-[var(--bg-hover)]'}"
                 on:click={() => handleActionSelect(action.id)} data-index={index} tabindex="0"
               >
                 <div class="flex-1 min-w-0">
                   <div class="font-medium text-[var(--text-primary)] break-words">{action.label}</div>
                   {#if action.description}
                     <div class="text-sm text-[var(--text-secondary)] break-words">{action.description}</div>
                   {/if}
                 </div>
               </button>
             {/each}
             {#if availableActions.length === 0}
                <div class="p-3 text-center text-sm text-[var(--text-secondary)]">No actions available in this context.</div>
             {/if}
             <div class="h-2"></div> <!-- Padding at bottom -->
           </div>
         </div>
     </div>
  </div>
{/if}

<!-- Action Panel (always visible at the bottom) -->
<div class="fixed bottom-0 left-0 right-0 z-30">
  <ActionPanel actions={actionPanelActions} on:action={handleActionPanelAction} />
</div>

<style>
  /* Styles specific to the action drawer can go here if needed, */
  /* but global styles affecting body are kept in +page.svelte */
</style>
