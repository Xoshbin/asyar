<script lang="ts">
  import { logService } from '../../services/log/logService';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import { Icon, ListItem, Input, KeyboardHint, EmptyState, ConfirmDialog } from '../../components';
  import { actionService } from '../../services/action/actionService.svelte';
  import type { ApplicationAction } from '../../services/action/actionService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { filterActions } from './actionFilter';
  import { actionUsageStore } from '../../services/action/actionUsageStore';

  let {
    availableActions = [],
    onclose
  }: {
    availableActions?: ApplicationAction[];
    onclose?: () => void;
  } = $props();

  let searchQuery = $state('');

  let filteredForSearch = $derived(filterActions(availableActions, searchQuery));

  let groupedActions = $derived((() => {
    const groups = new Map<string, typeof filteredForSearch>();
    for (const action of filteredForSearch) {
      const cat = (action as any).displayCategory ?? 'Actions';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(action);
    }
    return Array.from(groups.entries()).map(([cat, actions]) => [
      cat,
      actionUsageStore.sortByUsage(actions)
    ] as const);
  })());

  let flatActions = $derived(groupedActions.flatMap(([, actions]) => actions));

  let selectedIndex = $state(-1);
  let popupRef = $state<HTMLDivElement>();
  let pendingConfirmAction = $state<ApplicationAction | null>(null);

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const elements = Array.from(popupRef?.querySelectorAll('.list-row[data-index]') || []);
      elements[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closePopup();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (flatActions.length === 0) return;

    const totalActions = flatActions.length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        selectedIndex = selectedIndex >= totalActions - 1 ? 0 : selectedIndex + 1;
        scrollSelectedIntoView();
        break;

      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          selectedIndex = selectedIndex <= 0 ? totalActions - 1 : selectedIndex - 1;
        } else {
          selectedIndex = selectedIndex >= totalActions - 1 ? 0 : selectedIndex + 1;
        }
        scrollSelectedIntoView();
        break;

      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        if (selectedIndex <= 0) {
          selectedIndex = -1; // deselect all; focus stays on input naturally
        } else {
          selectedIndex = selectedIndex - 1;
          scrollSelectedIntoView();
        }
        break;

      case 'Enter':
        if (selectedIndex >= 0) {
          event.preventDefault();
          event.stopPropagation();
          const currentAction = flatActions[selectedIndex];
          if (currentAction) handleActionSelect(currentAction.id);
        }
        // selectedIndex === -1: let Enter pass through to the input naturally
        break;
    }
  }

  async function handleActionSelect(actionId: string) {
    logService.debug(`[ActionListPopup] Action selected: ${actionId}`);
    const action = flatActions.find(a => a.id === actionId);
    if (!action) return;

    actionUsageStore.record(actionId);

    if (action.confirm) {
      pendingConfirmAction = action;
      return; // don't close — wait for ConfirmDialog
    }

    closePopup();
    try {
      await actionService.executeAction(actionId);
      viewManager.showFeedback(action.label);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logService.error(`[ActionListPopup] Failed to execute action ${actionId}: ${error}`);
      viewManager.showFeedback(`Failed: ${msg}`, true, 4000);
    }
  }

  async function handleConfirmed() {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    closePopup();
    if (!action) return;
    
    actionUsageStore.record(action.id);

    try {
      await actionService.executeAction(action.id);
      viewManager.showFeedback(action.label);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logService.error(`[ActionListPopup] Failed to execute confirmed action ${action.id}: ${error}`);
      viewManager.showFeedback(`Failed: ${msg}`, true, 4000);
    }
  }

  function handleCancelled() {
    pendingConfirmAction = null;
  }

  function closePopup() {
    logService.debug('[ActionListPopup] Closing popup');
    onclose?.();
  }

  $effect(() => {
    selectedIndex = -1;
    const timer = setTimeout(() => {
      popupRef?.querySelector('input')?.focus();
    }, 50);
    popupRef?.addEventListener('keydown', handleKeydown);
    return () => {
      clearTimeout(timer);
      popupRef?.removeEventListener('keydown', handleKeydown);
      searchQuery = '';
    };
  });
</script>

<div
  bind:this={popupRef}
  class="action-popup"
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="action-list-heading"
>
  <h2 id="action-list-heading" class="sr-only">Available Actions</h2>

  <div class="action-search">
    <Input
      bind:value={searchQuery}
      placeholder="Filter actions..."
    />
  </div>

  <div class="action-scroll custom-scrollbar">
    {#each groupedActions as [category, groupActions], groupIndex}
      <div class="group-section" class:first-group={groupIndex === 0}>
        <div class="group-header">{category}</div>
        {#each groupActions as action}
          {@const flatIndex = flatActions.indexOf(action)}
          <div class:action-primary-item={flatIndex === 0}>
            <ListItem
              selected={flatIndex === selectedIndex}
              onclick={() => handleActionSelect(action.id)}
              data-index={flatIndex}
              tabindex="-1"
              title={action.label}
              subtitle={action.description}
            >
            {#snippet leading()}
              <span class="action-icon">
                {#if isBuiltInIcon(action.icon)}
                  <Icon name={getBuiltInIconName(action.icon!)} size={15} />
                {:else if action.icon && isIconImage(action.icon)}
                  <img src={action.icon} alt="" class="w-4 h-4 object-contain" />
                {:else if action.icon}
                  <span class="emoji-icon">{action.icon}</span>
                {/if}
              </span>
            {/snippet}

            {#snippet trailing()}
              {#if action.shortcut}
                <KeyboardHint keys={action.shortcut} />
              {/if}
            {/snippet}
          </ListItem>
        </div>
        {/each}
      </div>
    {:else}
      <EmptyState message="No matching actions" />
    {/each}
  </div>

  <ConfirmDialog
    isOpen={pendingConfirmAction !== null}
    title="Confirm Action"
    message="Are you sure you want to run '{pendingConfirmAction?.label}'? This cannot be undone."
    confirmButtonText="Confirm"
    cancelButtonText="Cancel"
    variant="danger"
    onconfirm={handleConfirmed}
    oncancel={handleCancelled}
  />
</div>

<style>
  .action-popup {
    position: fixed;
    bottom: 48px; /* 40px bar height + 8px gap */
    right: 12px;
    width: 320px;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg-popup) 85%, transparent);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-popup);
    overflow: hidden;
    z-index: 50;
    outline: none;
  }

  .action-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
  }

  :global(html[data-platform="linux"]) .action-popup {
    backdrop-filter: none;
    background-color: var(--bg-popup);
  }

  .group-section {
    margin-bottom: 4px;
  }

  .group-section:not(.first-group) {
    border-top: 1px solid var(--separator);
    padding-top: 4px;
    margin-top: 4px;
  }

  .group-header {
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    padding: 6px 10px 4px;
    user-select: none;
    position: sticky;
    top: -6px;
    z-index: 1;
    background: color-mix(in srgb, var(--bg-popup) 95%, transparent);
    margin: 0 -6px;
  }

  .action-search {
    padding: 10px 10px 4px 10px;
    border-bottom: 1px solid var(--separator);
  }

  .action-search :global(.input) {
    font-size: var(--font-size-sm);
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }

  .action-icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    overflow: hidden;
  }

  .emoji-icon {
    font-size: var(--font-size-xs);
    line-height: 1;
    display: block;
    max-width: 18px;
    max-height: 18px;
  }

  .action-primary-item :global(.text-title) {
    font-weight: 600;
    color: var(--accent-primary);
  }

</style>
