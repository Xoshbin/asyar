<script lang="ts">
  import { logService } from '../../services/log/logService';
  import { isIconImage } from '../../lib/iconUtils';
  import { actionService } from '../../services/action/actionService.svelte';
  import type { ApplicationAction } from '../../services/action/actionService.svelte';

  let {
    availableActions = [],
    onclose
  }: {
    availableActions?: ApplicationAction[];
    onclose?: () => void;
  } = $props();

  let groupedActions = $derived((() => {
    const groups = new Map<string, typeof availableActions>();
    for (const action of availableActions) {
      const cat = (action as any).displayCategory ?? 'Actions';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(action);
    }
    return Array.from(groups.entries());
  })());

  let flatActions = $derived(groupedActions.flatMap(([, actions]) => actions));

  let selectedIndex = $state(0);
  let actionButtons: HTMLButtonElement[] = $state([]);
  let popupRef = $state<HTMLDivElement>();

  function handleKeydown(event: KeyboardEvent) {
    if (flatActions.length === 0) return;

    const totalActions = flatActions.length;
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
        const currentAction = flatActions[selectedIndex];
        if (currentAction) {
          handleActionSelect(currentAction.id);
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
    onclose?.();
  }

  $effect(() => {
    selectedIndex = 0;
    const timer = setTimeout(() => {
      popupRef?.focus();
      focusSelectedAction();
    }, 50);
    popupRef?.addEventListener('keydown', handleKeydown);
    return () => {
      clearTimeout(timer);
      popupRef?.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div
  bind:this={popupRef}
  class="action-list-popup absolute bottom-full right-0 mb-2 z-50 w-full max-w-sm"
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="action-list-heading"
>
  <div
    class="overflow-hidden transition-all transform shadow-lg border border-[var(--border-color)] rounded-lg"
    style="max-height: 66vh; background-color: var(--bg-popup);"
  >
    <h2 id="action-list-heading" class="sr-only">Available Actions</h2>

    <div class="overflow-y-auto overscroll-contain p-2 flex-1" style="max-height: calc(66vh - 10px);">
      {#each groupedActions as [category, groupActions]}
        <div class="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] select-none">
          {category}
        </div>

        <div class="space-y-0.5">
          {#each groupActions as action}
            {@const flatIndex = flatActions.indexOf(action)}
            <button
              class="w-full text-left px-3 py-2 rounded border-none transition-colors flex items-center gap-3
                {flatIndex === selectedIndex
                  ? 'bg-[var(--bg-selected)] focus:outline-none'
                  : 'hover:bg-[var(--bg-hover)] focus:outline-none focus:bg-[var(--bg-hover)]'}"
              onclick={() => handleActionSelect(action.id)}
              data-index={flatIndex}
              tabindex="-1"
            >
              {#if isIconImage(action.icon)}
                <img src={action.icon} alt="" class="flex-shrink-0 w-5 h-5 object-contain" />
              {:else if action.icon}
                <span class="flex-shrink-0 w-5 text-center text-base leading-none">{action.icon}</span>
              {:else}
                <span class="flex-shrink-0 w-5"></span>
              {/if}
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-[var(--text-primary)] truncate">{action.label}</div>
                {#if action.description}
                  <div class="text-xs text-[var(--text-secondary)] truncate">{action.description}</div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {:else}
        <div class="p-3 text-center text-sm text-[var(--text-secondary)]">No actions available.</div>
      {/each}
      <div class="h-1"></div>
    </div>
  </div>
</div>


