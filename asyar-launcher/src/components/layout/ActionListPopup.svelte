<script lang="ts">
  import { logService } from '../../services/log/logService';
  import { isIconImage, isBuiltInIcon, getBuiltInIconName } from '../../lib/iconUtils';
  import Icon from '../base/Icon.svelte';
  import ListItem from '../list/ListItem.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import type { ApplicationAction } from '../../services/action/actionService.svelte';
  import { popupScale } from '$lib/transitions';

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
  let actionElements: HTMLElement[] = $state([]);
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
      case 'Tab':
        if (event.key === 'Tab' && event.shiftKey) {
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
      case ' ':
        const currentAction = flatActions[selectedIndex];
        if (currentAction) {
          handleActionSelect(currentAction.id);
        }
        break;
      default:
        preventDefault = false;
    }

    if (preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function focusSelectedAction() {
    requestAnimationFrame(() => {
      actionElements = Array.from(popupRef?.querySelectorAll('.list-row[data-index]') || []);
      actionElements[selectedIndex]?.focus();
    });
  }

  function handleActionSelect(actionId: string) {
    logService.debug(`[ActionListPopup] Action selected: ${actionId}`);
    closePopup();
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
  class="action-popup"
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="action-list-heading"
  transition:popupScale
>
  <h2 id="action-list-heading" class="sr-only">Available Actions</h2>

  <div class="action-scroll">
    {#each groupedActions as [category, groupActions], groupIndex}
      <div class="group-section" class:first-group={groupIndex === 0}>
        <div class="group-header">{category}</div>
        {#each groupActions as action}
          {@const flatIndex = flatActions.indexOf(action)}
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
          </ListItem>
        {/each}
      </div>
    {:else}
      <div class="empty-actions">No actions available.</div>
    {/each}
  </div>
</div>

<style>
  .action-popup {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 12px;
    width: 320px;
    max-height: 60vh;
    background: color-mix(in srgb, var(--bg-popup) 85%, transparent);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg, 10px);
    box-shadow: var(--shadow-popup);
    overflow: hidden;
    z-index: 50;
    display: flex;
    flex-direction: column;
    outline: none;
  }

  .action-scroll {
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
  }

  .action-icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
  }

  .emoji-icon {
    font-size: var(--font-size-base);
    line-height: 1;
  }

  .empty-actions {
    padding: 16px;
    text-align: center;
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }
</style>
