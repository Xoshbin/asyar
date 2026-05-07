<script lang="ts">
  import { logService } from '../../services/log/logService';
  import Input from '../base/Input.svelte';
  import LauncherListRow from '../list/LauncherListRow.svelte';
  import Icon from '../base/Icon.svelte';
  import { isBuiltInIcon, isIconImage, getBuiltInIconName } from '../../lib/iconUtils';
  import EmptyState from '../feedback/EmptyState.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import type { ApplicationAction } from '../../services/action/actionService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { filterActions } from './actionFilter';
  import { actionUsageStore } from '../../services/action/actionUsageStore';
  import { scrollSelectedIntoView } from '../../lib/listScroll';
  import { useListSelection } from '../../lib/listSelection.svelte';
  import { groupActionsForDisplay } from './actionListOrdering';

  type ActionForDisplay = ApplicationAction & { displayCategory: string };

  let {
    availableActions = [],
    selectedItemName = null,
    inExtensionView = false,
    onclose
  }: {
    availableActions?: ApplicationAction[];
    selectedItemName?: string | null;
    inExtensionView?: boolean;
    onclose?: () => void;
  } = $props();

  let showHeader = $derived(!inExtensionView && !!selectedItemName);

  let searchQuery = $state('');

  let filteredForSearch = $derived(filterActions(availableActions, searchQuery));

  let groupedActions = $derived(groupActionsForDisplay(filteredForSearch));

  let flatActions = $derived(groupedActions.flatMap((g) => g.actions));

  let popupRef = $state<HTMLDivElement>();

  const selection = useListSelection({ items: () => flatActions });

  function scrollSelected() {
    requestAnimationFrame(() => {
      if (popupRef) scrollSelectedIntoView(popupRef, selection.selectedIndex);
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Esc clears the filter first, then closes on the next press.
      if (searchQuery.length > 0) {
        searchQuery = '';
      } else {
        closePopup();
      }
      return;
    }

    if (flatActions.length === 0) return;

    const isDown = event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey);
    const isUp = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);

    if (isDown || isUp) {
      event.preventDefault();
      event.stopPropagation();
      selection.moveSelection(isDown ? 'down' : 'up');
      scrollSelected();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const action = selection.selectedItem;
      if (action) handleActionSelect(action.id);
    }
  }

  async function handleActionSelect(actionId: string) {
    logService.debug(`[ActionListPopup] Action selected: ${actionId}`);
    const action = flatActions.find(a => a.id === actionId);
    if (!action) return;

    // Close the popup BEFORE awaiting the confirm dialog so the user can't
    // pick a second action while the dialog is up. The dialog is rendered
    // by the global DialogHost; it doesn't need this popup to stay open.
    closePopup();

    if (action.confirm) {
      const confirmed = await feedbackService.confirmAlert({
        title: 'Confirm Action',
        message: `Are you sure you want to run '${action.label}'? This cannot be undone.`,
        confirmText: 'Confirm',
        variant: 'danger',
      });
      if (!confirmed) return;
    }

    try {
      await actionService.executeAction(actionId);
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'success',
        retryable: false,
        context: { message: action.label },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logService.error(`[ActionListPopup] Failed to execute action ${actionId}: ${error}`);
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Failed: ${msg}` },
      });
    }
  }

  function closePopup() {
    logService.debug('[ActionListPopup] Closing popup');
    onclose?.();
  }

  $effect(() => {
    const timer = setTimeout(() => {
      popupRef?.querySelector('input')?.focus({ preventScroll: true });
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

  <div class="action-scroll custom-scrollbar">
    {#if showHeader}
      <div class="popup-header">{selectedItemName}</div>
    {/if}
    {#each groupedActions as [, groupActions], groupIndex}
      <div class="group-section" class:first-group={groupIndex === 0}>
        {#each groupActions as action}
          {@const flatIndex = flatActions.indexOf(action)}
          <div
            class="action-row"
            class:action-destructive={action.destructive}
          >
            <LauncherListRow
              selected={flatIndex === selection.selectedIndex}
              onclick={() => handleActionSelect(action.id)}
              data-index={flatIndex}
              tabindex="-1"
              icon={action.icon}
              title={action.label}
              shortcut={action.shortcut}
              shortcutPlacement="trailing"
            >
              {#snippet leading()}
                {#if action.icon && isBuiltInIcon(action.icon)}
                  <div class="builtin-icon-tile">
                    <Icon name={getBuiltInIconName(action.icon)} size={18} />
                  </div>
                {:else if action.icon && isIconImage(action.icon)}
                  <img
                    src={action.icon}
                    alt={action.label}
                    class="action-icon-img"
                  />
                {:else if action.icon}
                  <div class="action-icon-fallback">
                    {action.icon}
                  </div>
                {/if}
              {/snippet}
            </LauncherListRow>
          </div>
        {/each}
      </div>
    {:else}
      <EmptyState message="No matching actions" />
    {/each}
  </div>

  <div class="action-search">
    <Input
      bind:value={searchQuery}
      placeholder="Search for actions..."
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck={false}
    />
  </div>
</div>

<style>
  .action-popup {
    position: fixed;
    bottom: 48px; /* 40px bar height + 8px gap */
    right: 12px;
    width: 350px;
    /* ~6 rows + search bar; keeps the popup from hiding the launcher bottom. */
    max-height: 243px;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg-popup) 80%, transparent);
    backdrop-filter: blur(60px) saturate(200%);
    -webkit-backdrop-filter: blur(60px) saturate(200%);
    border: 1px solid rgba(60, 60, 67, 0.16);
    border-radius: 20px;
    box-shadow:
      -28px 20px 80px -20px rgba(0, 0, 0, 0.3),
      -14px 10px 40px -16px rgba(0, 0, 0, 0.18),
      -4px 3px 12px -6px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    z-index: 50;
    outline: none;
  }

  /* Dark mode: brighter hairline + inner highlight so the popup reads as a
     distinct surface against the dim launcher chrome. */
  :global(html[data-theme="dark"]) .action-popup {
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.04),
      -28px 20px 80px -20px rgba(0, 0, 0, 0.7),
      -14px 10px 40px -16px rgba(0, 0, 0, 0.5),
      -4px 3px 12px -6px rgba(0, 0, 0, 0.35);
  }

  @media (prefers-color-scheme: dark) {
    :global(html:not([data-theme])) .action-popup {
      border-color: rgba(255, 255, 255, 0.18);
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.04),
        -28px 20px 80px -20px rgba(0, 0, 0, 0.7),
        -14px 10px 40px -16px rgba(0, 0, 0, 0.5),
        -4px 3px 12px -6px rgba(0, 0, 0, 0.35);
    }
  }

  .popup-header {
    padding: var(--space-4);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
    user-select: none;
  }

  .action-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Top inset is margin so the macOS overlay scrollbar track starts below
       the rounded top corner. */
    margin-top: var(--space-3);
    padding: 0 var(--space-3) var(--space-3);
  }

  :global(html[data-platform="linux"]) .action-popup {
    backdrop-filter: none;
    background-color: var(--bg-popup);
  }

  .group-section {
    margin-bottom: var(--space-1);
  }

  /* Negative side margins cancel .action-scroll's padding so the divider
     runs edge-to-edge while the rows stay inset. */
  .group-section:not(.first-group)::before {
    content: '';
    display: block;
    height: 1px;
    background-color: rgba(60, 60, 67, 0.11);
    margin: var(--space-4) calc(-1 * var(--space-3));
  }
  :global(html[data-theme="dark"]) .group-section:not(.first-group)::before,
  :global(html:not([data-theme])) .group-section:not(.first-group)::before {
    background-color: rgba(255, 255, 255, 0.07);
  }
  @media (prefers-color-scheme: light) {
    :global(html:not([data-theme])) .group-section:not(.first-group)::before {
      background-color: rgba(60, 60, 67, 0.11);
    }
  }

  .action-search {
    /* Matches the launcher search header height. */
    height: 41px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 var(--space-5);
    border-top: 1px solid rgba(60, 60, 67, 0.11);
    background: transparent;
    box-sizing: border-box;
  }
  .action-search :global(.input-wrapper),
  .action-search > :global(*) {
    width: 100%;
  }
  :global(html[data-theme="dark"]) .action-search,
  :global(html:not([data-theme])) .action-search {
    border-top-color: rgba(255, 255, 255, 0.07);
  }
  @media (prefers-color-scheme: light) {
    :global(html:not([data-theme])) .action-search {
      border-top-color: rgba(60, 60, 67, 0.11);
    }
  }

  .action-search :global(.input) {
    font-size: var(--font-size-md);
    padding: var(--space-1) 0;
    border: none;
    background: transparent;
    border-radius: 0;
    color: var(--text-primary);
    caret-color: color-mix(in srgb, var(--text-primary) 60%, var(--bg-secondary-full-opacity) 40%) !important;
  }
  .action-search :global(.input::placeholder) {
    color: color-mix(in srgb, var(--text-primary) 50%, var(--bg-secondary-full-opacity) 50%);
    font-weight: 500;
  }
  .action-search :global(.input:focus) {
    border: none;
    box-shadow: none;
  }

  .action-row :global(.result-title) {
    font-size: var(--font-size-md);
  }

  .action-icon-img {
    width: var(--space-7-5);
    height: var(--space-7-5);
    border-radius: var(--radius-xs);
    object-fit: contain;
    flex-shrink: 0;
  }

  .action-icon-fallback {
    width: var(--space-7-5);
    height: var(--space-7-5);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    flex-shrink: 0;
    border-radius: var(--radius-xs);
  }

  /* Flat glyph in the popup — no filled tile. */
  .action-popup :global(.builtin-icon-tile) {
    background-color: transparent;
    color: var(--text-primary);
  }

  .action-destructive :global(.result-title),
  .action-destructive :global(.builtin-icon-tile) {
    color: var(--accent-danger) !important;
  }
</style>
